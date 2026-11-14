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
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new Pool({ connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
    return {
      query: (text, params) => pool.query(text, params) as any,
      exec: async (text) => {
        await pool.query(text);
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

/** Creates the schema and, on an empty database, the demo school group. */
export function ready(): Promise<void> {
  return (g.__aed!.ready ??= (async () => {
    const d = await driver();
    const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
    await d.exec(schema);
    const { rows } = await d.query("select count(*)::int as n from tenants");
    const wantSeed = !process.env.DATABASE_URL || process.env.SEED_DEMO === "1";
    if (rows[0].n === 0 && wantSeed) {
      const { seedDemo } = await import("./seed");
      await booting.run(true, () => seedDemo());
    }
  })());
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
