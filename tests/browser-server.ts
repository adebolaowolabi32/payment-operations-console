import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../server/db.js";
const schema = "browser_" + randomUUID().replaceAll("-", "");
const db = new Database(
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
);
await db.query(`CREATE SCHEMA ${schema}`);
const dir = await mkdtemp(join(tmpdir(), "ledger-browser-"));
const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  DB_SCHEMA: schema,
  PORT: "3002",
  PROVIDER_PORT: "3004",
  PROVIDER_URL: "http://127.0.0.1:3004",
  PROVIDER_DB_PATH: join(dir, "provider.db"),
  LOG_SILENT: "true",
};
const children = [
  spawn(process.execPath, ["--import", "tsx", "server/simulator.ts"], {
    env,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env,
    stdio: "inherit",
  }),
];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(
      (c) =>
        new Promise<void>((r) => {
          if (c.exitCode !== null) return r();
          c.once("exit", () => r());
          c.kill("SIGTERM");
        }),
    ),
  );
  await db.query(`DROP SCHEMA ${schema} CASCADE`);
  await db.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void stop());
for (const c of children)
  c.on("exit", () => {
    if (!stopping) void stop();
  });
