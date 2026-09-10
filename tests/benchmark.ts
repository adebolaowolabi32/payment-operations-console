import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Database } from "../server/db.js";
import { Store, demoUsers, detailSelect } from "../server/domain.js";
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  schema = "benchmark_" + randomUUID().replaceAll("-", ""),
  root = new Database(url);
await root.query(`CREATE SCHEMA ${schema}`);
const db = new Database(url, schema);
try {
  await db.migrate();
  const store = new Store(db);
  await store.seed("benchmark-password", false);
  await db.query(
    "INSERT INTO payments(id,org_id,beneficiary_id,amount,reference,status,created_by,created_at,updated_at) SELECT 'bench_'||lpad(n::text,8,'0'),'org_cedar','ben_atlas',10000+n,'Benchmark invoice '||n,'pending','usr_maya',1800000000000+n,1800000000000+n FROM generate_series(1,10000) n",
  );
  await db.query("ANALYZE payments");
  const user = { ...demoUsers[0], org_id: "org_cedar" },
    started = performance.now();
  const page = await store.list(user, { limit: 20 });
  const elapsed = performance.now() - started;
  const plans = await db.query(
    "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " +
      detailSelect +
      " WHERE p.org_id='org_cedar' ORDER BY p.created_at DESC,p.id DESC LIMIT 21",
  );
  const report = {
    date: new Date().toISOString(),
    postgres: (await db.query("SELECT version()"))[0].version,
    fixtureRows: 10000,
    pageRows: page.items.length,
    pageBytes: Buffer.byteLength(JSON.stringify(page)),
    observedListMs: elapsed,
    note: "Single local run, warm database; not a production capacity claim.",
    plan: plans[0]["QUERY PLAN"],
  };
  await writeFile(
    "docs/QUERY-BENCHMARK.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ ...report, plan: undefined }));
} finally {
  await db.close();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.close();
}
