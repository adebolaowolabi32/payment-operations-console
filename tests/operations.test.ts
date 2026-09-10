import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fixture, admin } from "./helpers.js";
import { deliver } from "../server/delivery.js";
import { exportAudit } from "../server/audit-export.js";
import { createApp } from "../server/app.js";
import { createHmac, randomUUID } from "node:crypto";
import { maker, checker, input } from "./helpers.js";
test("delivery retries reuse the same idempotency key; audit checkpoint advances only after acceptance", async (t) => {
  const { store, db } = await fixture(t);
  const app = express();
  app.use(express.json());
  let accept = false;
  const keys: string[] = [],
    bodies: any[] = [];
  app.post("/", (req, res) => {
    assert.equal(req.get("Authorization"), "Bearer receiver-token");
    keys.push(req.get("Idempotency-Key")!);
    bodies.push(req.body);
    res.sendStatus(accept ? 200 : 503);
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  await store.invite(admin, "member@example.test", "viewer");
  await deliver(db, url, "receiver-token");
  assert.equal(
    (await db.query("SELECT delivered_at FROM delivery_outbox"))[0]
      .delivered_at,
    null,
  );
  await db.query("UPDATE delivery_outbox SET next_at=0");
  accept = true;
  await deliver(db, url, "receiver-token");
  assert.ok(
    (await db.query("SELECT delivered_at FROM delivery_outbox"))[0]
      .delivered_at,
  );
  assert.equal(keys[0], keys[1]);
  assert.equal(bodies[1].token.length, 64);
  accept = false;
  await assert.rejects(exportAudit(db, url, "receiver-token"));
  assert.equal(
    (await db.query("SELECT last_id FROM audit_exports"))[0].last_id,
    0,
  );
  accept = true;
  assert.ok(await exportAudit(db, url, "receiver-token"));
  assert.equal(keys[2], keys[3]);
  assert.equal(await exportAudit(db, url, "receiver-token"), 0);
});
test("signed callback HTTP boundary rejects tampering, replay timestamps, and cross-site mutations", async (t) => {
  const { store } = await fixture(t);
  process.env.WEBHOOK_SECRET = "test-webhook-secret";
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const url = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const p = await store.create(maker, input, randomUUID());
  await store.review(checker, p.id, "approve", 1);
  const body = JSON.stringify({
    id: "event-http",
    paymentId: p.id,
    amount: p.amount,
    receipt: "receipt",
    outcome: "confirmed",
  });
  async function callback(timestamp: string, valid = true) {
    return fetch(url + "/api/provider/callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Provider-Timestamp": timestamp,
        "X-Provider-Signature": valid
          ? createHmac("sha256", process.env.WEBHOOK_SECRET!)
              .update(timestamp + "." + body)
              .digest("hex")
          : "0".repeat(64),
      },
      body,
    });
  }
  assert.equal((await callback(String(Date.now()), false)).status, 401);
  assert.equal((await callback(String(Date.now() - 600000))).status, 401);
  assert.equal((await callback(String(Date.now()))).status, 200);
  assert.equal((await callback(String(Date.now()))).status, 200);
  assert.equal((await store.payment(maker, p.id)).status, "paid");
  assert.equal(
    (
      await fetch(url + "/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "LedgerDesk",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ email: maker.email, password: "test-password" }),
      })
    ).status,
    403,
  );
});
