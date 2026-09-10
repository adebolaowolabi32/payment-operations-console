import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture, maker, checker, input } from "./helpers.js";
import { Database } from "../server/db.js";
import { Store } from "../server/domain.js";
import { Worker } from "../server/worker.js";
const run = promisify(execFile);
test("pg_dump and pg_restore preserve queued payments, history, migrations, and processable jobs", async (t) => {
  const { store, db, schema } = await fixture(t);
  const p = await store.create(maker, input, randomUUID());
  await store.review(checker, p.id, "approve", 1);
  const dir = await mkdtemp(join(tmpdir(), "ledger-backup-")),
    file = join(dir, "backup.dump"),
    name = "restore_" + randomUUID().replaceAll("-", "");
  const source =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://ledgerdesk:ledgerdesk@127.0.0.1:5432/ledgerdesk";
  const target = new URL(source);
  target.pathname = "/" + name;
  await run("pg_dump", [
    "--dbname",
    source,
    "--schema",
    schema,
    "--format=custom",
    "--file",
    file,
  ]);
  await db.query(`CREATE DATABASE ${name}`);
  const restored = new Database(target.toString(), schema);
  t.after(async () => {
    await restored.close();
    const cleanup = new Database(source);
    try {
      await cleanup.query(`DROP DATABASE ${name}`);
    } finally {
      await cleanup.close();
    }
    await rm(dir, { recursive: true, force: true });
  });
  await run("pg_restore", [
    "--dbname",
    target.toString(),
    "--no-owner",
    "--exit-on-error",
    file,
  ]);
  await restored.migrate();
  const copy = new Store(restored);
  assert.equal((await copy.payment(maker, p.id)).status, "queued");
  assert.equal((await copy.history(maker, {}, p.id)).items.length, 2);
  await new Worker(copy, {
    submit: async () => ({
      kind: "confirmed",
      receipt: "restored-receipt",
      providerRequestId: "restored",
    }),
    lookup: async () => ({ kind: "not_found", detail: "Missing" }),
  }).tick();
  assert.equal((await copy.payment(maker, p.id)).status, "paid");
});
