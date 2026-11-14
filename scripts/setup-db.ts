// Creates the schema (and demo data when SEED_DEMO=1 or no DATABASE_URL) and prints a summary.
import { q, ready } from "../lib/db";
(async () => {
  const t0 = Date.now();
  await ready();
  const rows = await q("select (select count(*)::int from tenants) tenants, (select count(*)::int from users) users, (select count(*)::int from households) households, (select count(*)::int from enquiries) enquiries, (select count(*)::int from activities) activities, (select count(*)::int from tasks) tasks");
  console.log("Database ready in", Date.now() - t0, "ms", rows[0]);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
