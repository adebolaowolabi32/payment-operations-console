import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  fixture,
  maker,
  checker,
  admin,
  viewer,
  input,
  code,
} from "./helpers.js";
import { Database } from "../server/db.js";
import { Store } from "../server/domain.js";
import { Worker } from "../server/worker.js";
import { decrypt } from "../server/security.js";
import type { PaymentProvider, ProviderResult } from "../server/provider.js";
const healthy: PaymentProvider = {
  submit: async () => ({
    kind: "confirmed",
    receipt: "receipt",
    providerRequestId: "provider-id",
  }),
  lookup: async () => ({ kind: "not_found", detail: "Missing" }),
};
async function queued(store: Store) {
  const p = await store.create(maker, input, randomUUID());
  return store.review(checker, p.id, "approve", p.version);
}
test("integer money and idempotency remain correct under concurrent requests", async (t) => {
  const { store, db } = await fixture(t);
  const [a, b] = await Promise.all([
    store.create(maker, { ...input, amount: "10" }, "same-request-key"),
    store.create(maker, { ...input, amount: "10.00" }, "same-request-key"),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.amount, 1000);
  await assert.rejects(
    store.create(maker, { ...input, amount: "11" }, "same-request-key"),
    code(409),
  );
  for (const amount of ["0", "-2", "1.001", "1e3", "NaN", "100000000", "01.00"])
    await assert.rejects(
      store.create(maker, { ...input, amount }, "invalid-amount-key"),
    );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM payments"))[0].n,
    1,
  );
});
test("role checks, self-approval, and optimistic versions protect independent review", async (t) => {
  const { store } = await fixture(t);
  for (const user of [viewer, checker])
    await assert.rejects(store.create(user, input, randomUUID()), code(403));
  const p = await store.create(admin, input, randomUUID());
  await assert.rejects(
    store.review(admin, p.id, "approve", p.version),
    code(403),
  );
  await assert.rejects(
    store.review(maker, p.id, "approve", p.version),
    code(403),
  );
  await store.review(checker, p.id, "approve", p.version);
  await assert.rejects(
    store.review(checker, p.id, "approve", p.version),
    code(409),
  );
});
test("queue and audit insertion failures roll back the entire approval", async (t) => {
  const { store, db } = await fixture(t);
  for (const table of ["jobs", "audit"]) {
    const p = await store.create(maker, input, randomUUID());
    await db.query(
      `CREATE FUNCTION inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected failure'; END; $$; CREATE TRIGGER injected BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION inject_failure()`,
    );
    await assert.rejects(store.review(checker, p.id, "approve", p.version));
    assert.equal((await store.payment(maker, p.id)).status, "pending");
    assert.equal(
      (
        await db.query("SELECT count(*)::int n FROM jobs WHERE payment_id=$1", [
          p.id,
        ])
      )[0].n,
      0,
    );
    await db.query(
      `DROP TRIGGER injected ON ${table}; DROP FUNCTION inject_failure()`,
    );
  }
});
test("rejection needs a reason, creates no job, and is terminal", async (t) => {
  const { store, db } = await fixture(t);
  const p = await store.create(maker, input, randomUUID());
  await assert.rejects(
    store.review(checker, p.id, "reject", p.version, "no"),
    code(400),
  );
  await store.review(
    checker,
    p.id,
    "reject",
    p.version,
    "Incorrect invoice reference",
  );
  await assert.rejects(store.review(checker, p.id, "approve", 2), code(409));
  assert.equal((await db.query("SELECT count(*)::int n FROM jobs"))[0].n, 0);
});
test("concurrent workers claim exclusively; dead leases recover and stale completions cannot commit", async (t) => {
  const { store, advance } = await fixture(t);
  const p = await queued(store);
  const a = new Worker(store, healthy, "worker-a"),
    b = new Worker(store, healthy, "worker-b");
  const claims = await Promise.all([a.claim(), b.claim()]);
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims[0] ? a : b,
    second = claims[0] ? b : a,
    claim = claims.find(Boolean)!;
  advance(11000);
  const recovered = await second.claim();
  assert.ok(recovered);
  await second.process(recovered);
  assert.equal(
    await first.complete(
      claim,
      p,
      { kind: "declined", detail: "Late failure" },
      "submit",
      randomUUID(),
      store.now(),
    ),
    false,
  );
  assert.equal((await store.payment(maker, p.id)).status, "paid");
  assert.equal(
    (await store.history(admin, {}, p.id, true)).items.filter(
      (a) => a.outcome !== "started",
    ).length,
    2,
  );
});
test("unknown outcomes stay reconciling through lookup outages and forbid manual retries", async (t) => {
  const { store, advance } = await fixture(t);
  let submissions = 0,
    lookups = 0;
  const provider: PaymentProvider = {
    submit: async () => {
      submissions++;
      return { kind: "unknown", detail: "Accepted but response lost" };
    },
    lookup: async () => {
      lookups++;
      return { kind: "unavailable", detail: "Lookup unavailable" };
    },
  };
  const p = await queued(store),
    w = new Worker(store, provider);
  for (let i = 0; i < 5; i++) {
    await w.tick();
    advance(120000);
  }
  assert.equal((await store.payment(maker, p.id)).status, "reconciling");
  assert.equal(submissions, 1);
  assert.equal(lookups, 4);
  await assert.rejects(store.retry(checker, p.id), code(409));
});
test("permanent declines do not retry; explicit outages exhaust and retain attempts across retry cycles", async (t) => {
  const { store, advance } = await fixture(t);
  let outcome: ProviderResult = {
    kind: "declined",
    detail: "Permanent decline",
  };
  const provider: PaymentProvider = {
    submit: async () => outcome,
    lookup: healthy.lookup,
  };
  const p = await queued(store),
    w = new Worker(store, provider);
  await w.tick();
  advance();
  assert.equal(await w.tick(), 0);
  assert.equal((await store.payment(maker, p.id)).status, "declined");
  outcome = { kind: "unavailable", detail: "Unavailable before acceptance" };
  const failed = await queued(store);
  for (let i = 0; i < 3; i++) {
    await w.tick();
    advance();
  }
  assert.equal((await store.payment(maker, failed.id)).status, "failed");
  await assert.rejects(store.retry(maker, failed.id), code(403));
  await store.retry(checker, failed.id);
  outcome = { kind: "confirmed", receipt: "receipt", providerRequestId: "id" };
  await w.tick();
  assert.equal((await store.payment(maker, failed.id)).status, "paid");
  assert.equal(
    (await store.history(admin, {}, failed.id, true)).items.filter(
      (a) => a.outcome !== "started",
    ).length,
    4,
  );
});
test("duplicate and reordered callbacks cannot regress final state or accept mismatched amounts", async (t) => {
  const { store } = await fixture(t);
  const p = await queued(store);
  const event = {
    id: "callback-1",
    paymentId: p.id,
    amount: p.amount,
    receipt: "receipt",
    outcome: "confirmed" as const,
  };
  await assert.rejects(store.callback({ ...event, amount: 1 }), code(400));
  await store.callback(event);
  await store.callback(event);
  await store.callback({ ...event, id: "callback-2", outcome: "declined" });
  assert.equal((await store.payment(maker, p.id)).status, "paid");
  assert.equal(
    (await store.history(admin, {}, p.id)).items.filter(
      (a) => a.action === "payment.paid",
    ).length,
    1,
  );
});
test("organization boundaries apply to detail, review, retry, history, and direct service calls", async (t) => {
  const { store } = await fixture(t);
  const p = await queued(store),
    other = { ...admin, org_id: "org_harbor" };
  for (const fn of [
    () => store.payment(other, p.id),
    () => store.review(other, p.id, "approve", p.version),
    () => store.retry(other, p.id),
    () => store.history(other, {}, p.id),
    () => store.history(other, {}, p.id, true),
  ])
    await assert.rejects(fn(), code(404));
  assert.equal((await store.list(other, {})).items.length, 0);
  await assert.rejects(
    store.list({ ...maker, org_id: "org_harbor" }, {}),
    code(403),
  );
});
test("cursor pagination handles ties and retrieves payment history older than 500 global events", async (t) => {
  const { store, db } = await fixture(t);
  const ids = [];
  for (let i = 0; i < 7; i++)
    ids.push((await store.create(maker, input, randomUUID())).id);
  let cursor: string | null = null;
  const seen: string[] = [];
  do {
    const result = await store.list(admin, {
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...result.items.map((p) => p.id));
    cursor = result.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 7);
  assert.deepEqual(seen, [...ids].sort().reverse());
  const first = await store.list(admin, { limit: 2 });
  await assert.rejects(
    store.list(admin, { limit: 2, sort: "oldest", cursor: first.nextCursor }),
    code(400),
  );
  await db.query(
    "INSERT INTO audit(org_id,actor,action,detail,created_at) SELECT 'org_cedar','system','noise','Noise',$1 FROM generate_series(1,550)",
    [store.now()],
  );
  assert.equal(
    (await store.history(admin, {}, ids[0])).items[0].action,
    "payment.created",
  );
  assert.equal(
    (await store.history(admin, {})).items.filter(
      (a) => a.outcome !== "started",
    ).length,
    20,
  );
});
test("active sessions observe revocation and credential changes; last admin cannot be removed", async (t) => {
  const { store, advance } = await fixture(t);
  const { token } = await store.login(maker.email, "test-password");
  await store.memberRole(admin, maker.id, "viewer", true);
  assert.equal((await store.user(token))?.role, "viewer");
  await assert.rejects(store.create(maker, input, randomUUID()), code(403));
  await store.memberRole(admin, maker.id, "viewer", false);
  assert.equal(await store.user(token), undefined);
  await assert.rejects(
    store.memberRole(admin, admin.id, "viewer", false),
    code(409),
  );
  const login = await store.login(admin.email, "test-password");
  await store.rotatePassword(admin, "test-password", "replacement-password");
  assert.equal(await store.user(login.token), undefined);
  await assert.rejects(store.login(admin.email, "test-password"), code(401));
  const next = await store.login(admin.email, "replacement-password");
  advance(9 * 3600000);
  assert.equal(await store.user(next.token), undefined);
});
test("invitations and recovery use one-time delivered tokens and revoke sessions", async (t) => {
  const { store, db } = await fixture(t);
  await store.invite(admin, "new@example.test", "maker");
  let row = (
    await db.query("SELECT * FROM delivery_outbox WHERE kind='invitation'")
  )[0];
  assert.ok(!row.payload.includes("token"));
  const { token } = JSON.parse(decrypt(row.payload));
  await store.acceptInvitation({
    token,
    name: "New Member",
    password: "invited-password",
  });
  await assert.rejects(
    store.acceptInvitation({
      token,
      name: "New Member",
      password: "invited-password",
    }),
    code(400),
  );
  const login = await store.login("new@example.test", "invited-password");
  assert.equal(login.user.role, "maker");
  assert.deepEqual(
    await store.requestRecovery("unknown@example.test"),
    await store.requestRecovery("new@example.test"),
  );
  row = (
    await db.query("SELECT * FROM delivery_outbox WHERE kind='recovery'")
  )[0];
  const recovery = JSON.parse(decrypt(row.payload)).token;
  await store.recover(recovery, "recovered-password");
  assert.equal(await store.user(login.token), undefined);
  await assert.rejects(store.recover(recovery, "another-password"), code(400));
  await store.login("new@example.test", "recovered-password");
});
test("append-only histories reject edits, migrations are repeatable, and queued jobs survive reconnect", async (t) => {
  const { store, db, schema } = await fixture(t);
  await db.migrate();
  await assert.rejects(db.query("UPDATE audit SET detail='altered'"));
  await assert.rejects(db.query("DELETE FROM audit"));
  const p = await queued(store);
  const next = new Database(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
    schema,
  );
  t.after(() => next.close());
  const restarted = new Store(next);
  await new Worker(restarted, healthy).tick();
  assert.equal((await restarted.payment(maker, p.id)).status, "paid");
  await assert.rejects(db.query("UPDATE attempts SET detail='altered'"));
});
test("readiness data detects a stopped worker with an aging queue", async (t) => {
  const { store, advance } = await fixture(t);
  await queued(store);
  await new Worker(store, healthy).heartbeat();
  advance(20000);
  const h = await store.health();
  assert.equal(h.queued, 1);
  assert.ok(h.queue_age_ms >= 20000);
  assert.ok(store.now() - h.last_worker >= 20000);
});

test("concurrent recovery tokens serialize, and password rotation invalidates outstanding recovery links", async (t) => {
  const { store, db } = await fixture(t);
  await store.requestRecovery(maker.email);
  await store.requestRecovery(maker.email);
  const tokens = (
    await db.query(
      "SELECT payload FROM delivery_outbox WHERE kind='recovery' ORDER BY id",
    )
  ).map((r) => JSON.parse(decrypt(r.payload)).token);
  const results = await Promise.allSettled(
    tokens.map((token) => store.recover(token, "new-recovery-password")),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failed = results.find((r) => r.status === "rejected");
  assert.ok(failed && failed.status === "rejected" && code(400)(failed.reason));
  await store.requestRecovery(maker.email);
  const last = JSON.parse(
    decrypt(
      (
        await db.query(
          "SELECT payload FROM delivery_outbox WHERE kind='recovery' ORDER BY id DESC LIMIT 1",
        )
      )[0].payload,
    ),
  ).token;
  await store.rotatePassword(
    maker,
    "new-recovery-password",
    "rotated-password",
  );
  await assert.rejects(store.recover(last, "stale-link-password"), code(400));
});
