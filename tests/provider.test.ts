import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { fixture, maker, checker, admin, input } from "./helpers.js";
import { HttpProvider } from "../server/provider.js";
import { Worker } from "../server/worker.js";
async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
test("HTTP acceptance timeout and provider restart reconcile to one durable transfer", async (t) => {
  const { store, advance } = await fixture(t);
  const dir = await mkdtemp(join(tmpdir(), "ledger-provider-")),
    path = join(dir, "provider.db"),
    port = await freePort();
  const start = () =>
    spawn(process.execPath, ["--import", "tsx", "server/simulator.ts"], {
      env: {
        ...process.env,
        PROVIDER_DB_PATH: path,
        PROVIDER_PORT: String(port),
      },
      stdio: "pipe",
    });
  let child = start();
  const stop = () =>
    new Promise<void>((r) => {
      if (child.exitCode !== null) return r();
      child.once("exit", () => r());
      child.kill("SIGTERM");
    });
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  const provider = new HttpProvider("http://127.0.0.1:" + port, undefined, 100),
    ready = async () => {
      for (let i = 0; i < 100; i++) {
        if (await provider.healthy()) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("Provider failed to start");
    };
  await ready();
  await store.setMode(admin, "timeout_once");
  const p = await store.create(maker, input, randomUUID());
  await store.review(checker, p.id, "approve", 1);
  const w = new Worker(store, provider);
  await w.tick();
  assert.equal((await store.payment(maker, p.id)).status, "reconciling");
  await stop();
  child = start();
  await ready();
  advance();
  await w.tick();
  assert.equal((await store.payment(maker, p.id)).status, "paid");
  const sqlite = new DatabaseSync(path);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM transfers").get()!.n, 1);
  sqlite.close();
});
