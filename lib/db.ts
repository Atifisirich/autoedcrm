import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

export type Row = Record<string, any>;
type Driver = { query: (text: string, params?: any[]) => Promise<{ rows: Row[] }>; exec: (text: string) => Promise<void> };

const g = globalThis as unknown as { __aed?: { driver?: Promise<Driver>; ready?: Promise<void> } };
g.__aed ??= {};
// Code running inside boot (the seeder) must not wait for boot to finish.
const booting = new AsyncLocalStorage<boolean>();

async function makeDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool, types } = await import("pg");
    types.setTypeParser(20, (v: string) => Number(v));
    types.setTypeParser(1700, (v: string) => Number(v));
    types.setTypeParser(1082, (v: string) => v);
    // DATABASE_URL may hold several comma-separated candidates (for example two pooler hosts);
    // the first that answers is used.
    let pool: InstanceType<typeof Pool> | null = null;
    let lastError: unknown;
    for (const candidate of url.split(",").map((u) => u.trim()).filter(Boolean)) {
      const local = /localhost|127\.0\.0\.1/.test(candidate);
      const p = new Pool({ connectionString: candidate, max: Number(process.env.DB_POOL_MAX) || 3, connectionTimeoutMillis: 8000, ssl: local ? undefined : { rejectUnauthorized: false } });
      try { await p.query("select 1"); pool = p; break; } catch (e) { lastError = e; await p.end().catch(() => {}); }
    }
    if (!pool) throw new Error("Could not connect to the database: " + ((lastError as Error)?.message ?? "unknown error"));
    const db = pool;
    return {
      query: (text, params) => db.query(text, params) as any,
      exec: async (text) => {
        await db.query(text);
      },
    };
  }
  const { PGlite, types } = await import("@electric-sql/pglite");
  const db = new PGlite({
    parsers: { [types.NUMERIC]: (v: string) => Number(v), [types.INT8]: (v: string) => Number(v), [types.DATE]: (v: string) => v },
  });
  await db.waitReady;
  return {
    query: (text, params) => db.query(text, params) as any,
    exec: async (text) => {
      await db.exec(text);
    },
  };
}

function driver(): Promise<Driver> {
  return (g.__aed!.driver ??= makeDriver());
}

/**
 * Creates the schema and, on an empty database, the demo school group.
 * Serverless hosts start several instances at once, so the schema is only applied when it is
 * missing (or FORCE_SCHEMA=1), and a one-row table decides which instance does the seeding.
 */
export function ready(): Promise<void> {
  return (g.__aed!.ready ??= (async () => {
    const d = await driver();
    const exists = (await d.query("select to_regclass('support_access') is not null as ok")).rows[0].ok;
    if (!exists || process.env.FORCE_SCHEMA === "1") {
      const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
      await d.exec(schema);
    }
    const wantSeed = !process.env.DATABASE_URL || process.env.SEED_DEMO === "1";
    if (!wantSeed) return;
    await d.exec("create table if not exists boot_lock (id int primary key, done boolean not null default false, at timestamptz not null default now())");
    const won = (await d.query("insert into boot_lock (id) values (1) on conflict do nothing returning id")).rows.length === 1;
    if (won) {
      try {
        const { seedDemo } = await import("./seed");
        await booting.run(true, () => seedDemo());
        await d.query("update boot_lock set done=true where id=1");
      } catch (e) {
        await d.query("delete from boot_lock where id=1");
        throw e;
      }
      return;
    }
    // Another instance is seeding: wait for it rather than serving a half-filled database.
    for (let i = 0; i < 120; i++) {
      const r = (await d.query("select done from boot_lock where id=1")).rows[0];
      if (!r || r.done) return;
      await new Promise((res) => setTimeout(res, 1000));
    }
  })().catch((e) => { g.__aed!.ready = undefined; throw e; }));
}

const prep = (v: any) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);

async function rawQuery(text: string, params: any[] = []): Promise<Row[]> {
  const d = await driver();
  return (await d.query(text, params.map(prep))).rows;
}

export async function q(text: string, params: any[] = []): Promise<Row[]> {
  if (!booting.getStore()) await ready();
  return rawQuery(text, params);
}

export async function one(text: string, params: any[] = []): Promise<Row | null> {
  return (await q(text, params))[0] ?? null;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("bad identifier " + s);
  return s;
};

export async function insert(table: string, data: Row): Promise<Row> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const sql = `insert into ${ident(table)} (${keys.map(ident).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`;
  const params = keys.map((k) => data[k]);
  return (await q(sql, params))[0];
}

/** Tenant-scoped update by id. */
export async function update(table: string, tenantId: string, id: string, data: Row): Promise<Row | null> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return null;
  const sql = `update ${ident(table)} set ${keys.map((k, i) => `${ident(k)}=$${i + 3}`).join(",")} where tenant_id=$1 and id=$2 returning *`;
  return (await q(sql, [tenantId, id, ...keys.map((k) => data[k])]))[0] ?? null;
}
