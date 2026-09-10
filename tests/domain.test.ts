import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, demoUsers, AppError } from "../server/domain.js";
const [maker, checker, admin, viewer] = demoUsers;
const input = {
  beneficiaryId: "ben_atlas",
  amount: "1234.56",
  reference: "Invoice testing",
};
function fixture(t: { after: (fn: () => void) => void }) {
  let clock = 1_800_000_000_000;
  const store = new Store(":memory:", () => clock);
  store.seed("test-password", false);
  t.after(() => store.db.close());
  return { store, advance: (n = 60_000) => (clock += n) };
}
const code = (n: number) => (e: unknown) =>
  e instanceof AppError && e.status === n;
test("money is stored in integer minor units; malformed, zero, and oversized amounts are rejected", (t) => {
  const { store } = fixture(t);
  assert.equal(store.create(maker, input, "valid-amount-key").amount, 123456);
  for (const amount of ["0", "-2", "1.001", "1e3", "NaN", "100000000", "01.00"])
    assert.throws(() =>
      store.create(maker, { ...input, amount }, "bad-amount-" + amount),
    );
});
test("idempotency survives equivalent formatting and rejects conflicting payloads", (t) => {
  const { store } = fixture(t);
  const a = store.create(maker, { ...input, amount: "10" }, "same-request-key");
  const b = store.create(
    maker,
    { ...input, amount: "10.00" },
    "same-request-key",
  );
  assert.equal(a.id, b.id);
  assert.throws(
    () => store.create(maker, { ...input, amount: "11" }, "same-request-key"),
    code(409),
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM payments").get()!.n,
    1,
  );
});
test("viewer and checker cannot create; maker cannot review", (t) => {
  const { store } = fixture(t);
  for (const u of [viewer, checker])
    assert.throws(() => store.create(u, input, "permission-key"), code(403));
  const p = store.create(maker, input, "maker-create-key");
  assert.throws(
    () => store.review(maker, p.id, "approve", p.version),
    code(403),
  );
});
test("admin cannot approve their own payment; independent reviewer can", (t) => {
  const { store } = fixture(t);
  const p = store.create(admin, input, "admin-create-key");
  assert.throws(
    () => store.review(admin, p.id, "approve", p.version),
    code(403),
  );
  assert.equal(
    store.review(checker, p.id, "approve", p.version).status,
    "queued",
  );
});
test("approval is single-use and atomically creates an outbox entry and audit event", (t) => {
  const { store } = fixture(t);
  const p = store.create(maker, input, "review-request-key");
  store.review(checker, p.id, "approve", p.version);
  assert.throws(
    () => store.review(admin, p.id, "approve", p.version),
    code(409),
  );
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM jobs").get()!.n, 1);
  assert.equal(
    store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='payment.approved'",
      )
      .get()!.n,
    1,
  );
});
test("failed enqueue rolls back the approval and audit write", (t) => {
  const { store } = fixture(t);
  const p = store.create(maker, input, "rollback-request-key");
  store.db.exec(
    "CREATE TRIGGER fail_queue BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'Injected queue fault'); END",
  );
  assert.throws(() => store.review(checker, p.id, "approve", p.version));
  assert.equal(store.payment(p.id).status, "pending");
  assert.equal(
    store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit WHERE action='payment.approved'",
      )
      .get()!.n,
    0,
  );
});
test("rejection requires a reason, never queues, and cannot later be approved", (t) => {
  const { store } = fixture(t);
  const p = store.create(maker, input, "reject-request-key");
  assert.throws(
    () => store.review(checker, p.id, "reject", p.version, "no"),
    code(400),
  );
  assert.equal(
    store.review(
      checker,
      p.id,
      "reject",
      p.version,
      "Incorrect invoice reference",
    ).status,
    "rejected",
  );
  store.tick();
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM provider_receipts").get()!.n,
    0,
  );
  assert.throws(
    () => store.review(admin, p.id, "approve", p.version),
    code(409),
  );
});
test("provider acceptance followed by timeout reconciles to one receipt", (t) => {
  const { store, advance } = fixture(t);
  store.setMode(admin, "timeout_once");
  const p = store.create(maker, input, "timeout-request-key");
  store.review(checker, p.id, "approve", p.version);
  store.tick();
  assert.equal(store.payment(p.id).status, "retrying");
  assert.equal(store.tick(), 0);
  advance();
  store.tick();
  assert.equal(store.payment(p.id).status, "paid");
  advance();
  store.tick();
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM provider_receipts").get()!.n,
    1,
  );
});
test("outage exhausts three attempts and an authorized retry can recover", (t) => {
  const { store, advance } = fixture(t);
  store.setMode(admin, "offline");
  const p = store.create(maker, input, "outage-request-key");
  store.review(checker, p.id, "approve", p.version);
  for (let i = 0; i < 3; i++) {
    store.tick();
    advance();
  }
  assert.equal(store.payment(p.id).status, "failed");
  assert.equal(store.tick(), 0);
  assert.throws(() => store.retry(maker, p.id), code(403));
  store.setMode(admin, "healthy");
  store.retry(checker, p.id);
  store.tick();
  assert.equal(store.payment(p.id).status, "paid");
});
test("audit records resist update/delete through database triggers", (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.db.exec("UPDATE audit SET detail='altered'"));
  assert.throws(() => store.db.exec("DELETE FROM audit"));
});
test("sessions expire and logout revokes them; passwords are not stored as plaintext", (t) => {
  const { store, advance } = fixture(t);
  assert.throws(() => store.login(maker.email, "wrong"), code(401));
  const { token } = store.login(maker.email, "test-password");
  assert.equal(store.user(token)!.id, maker.id);
  store.logout(token);
  assert.equal(store.user(token), undefined);
  const next = store.login(maker.email, "test-password");
  advance(9 * 60 * 60 * 1000);
  assert.equal(store.user(next.token), undefined);
  assert.notEqual(
    store.db.prepare("SELECT password_hash FROM users LIMIT 1").get()!
      .password_hash,
    "test-password",
  );
});
test("approved work survives restart and is processed from the persistent outbox", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-restart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "test.db");
  let store = new Store(path);
  store.seed("test-password", false);
  const p = store.create(maker, input, "restart-request-key");
  store.review(checker, p.id, "approve", p.version);
  store.db.close();
  store = new Store(path);
  t.after(() => store.db.close());
  store.tick();
  assert.equal(store.payment(p.id).status, "paid");
});
