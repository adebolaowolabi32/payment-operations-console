# Backend review and next steps

Reviewed against the current LedgerDesk implementation. These are proposed improvements; the UI refresh does not implement them.

## 1. Split payment orchestration from the provider simulator

**Current code:** `Store.tick()` in `server/domain.ts` reads a receipt from the same SQLite database and writes a mock receipt directly. All provider errors share one retry path.

**Change:** introduce a `PaymentProvider` interface with `submit(payment, idempotencyKey)` and `lookup(idempotencyKey)`. Represent confirmed success, permanent rejection, temporary unavailability, and ambiguous timeout as different outcomes. Add a reconciliation state for an unknown result. Persist every provider attempt separately, including its request ID, result classification, and timestamps.

**Why first:** this adds more engineering depth than adding another screen or more infrastructure. It forces the system to distinguish “failed” from “might already have been paid.” It also makes provider behavior independently testable.

**Acceptance tests:** a response lost after acceptance causes one transfer; a permanent decline never retries; an unavailable status lookup keeps the payment unresolved; duplicated or reordered callbacks do not regress final state. Use a separate fake HTTP provider process to exercise actual network timeouts and restart windows.

## 2. Add PostgreSQL migrations and safe worker claims

**Current code:** startup creates tables using `CREATE TABLE IF NOT EXISTS`; the timer in `server/index.ts` and `Store.tick()` assume a single process. Jobs are selected without an owner or lease. Starting a second worker is unsupported.

**Change:** add versioned migrations, a database adapter, and atomic job claiming. In a PostgreSQL transaction, claim eligible jobs using row locks with `SKIP LOCKED`, set an owner and lease expiry, and commit before network I/O. On completion, update only if the worker still owns that lease. Recover expired leases. Continue using stable provider idempotency keys: database locking alone cannot guarantee one remote transfer.

**Acceptance tests:** run two workers against the same database; show exclusive active claims, recovery after a worker dies, stale-worker completion rejection, and one provider transfer after retries. Test rollback when audit or outbox insertion fails using the actual PostgreSQL adapter.

PostgreSQL specifically describes `SKIP LOCKED` as useful for multiple consumers of a queue-like table. It is not a general-purpose consistent read strategy. [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)

Keep the existing SQL outbox initially. If independent queue infrastructure becomes useful, BullMQ supports attempts, exponential backoff, and jitter, but adding Redis does not remove the need to make database-to-queue delivery reliable. [BullMQ retry documentation](https://docs.bullmq.io/guide/retrying-failing-jobs)

## 3. Make workspace reads bounded and history complete

**Current code:** `GET /api/workspace` returns every payment and beneficiary, all user summaries, and the latest 500 audit events. Clients download it every three seconds. Payment history is filtered from that global 500-event list, so an older payment can have an incomplete history.

**Change:** separate summary, payment-list, payment-detail, and audit endpoints. Add cursor pagination, server-side status/search/sort filters, and a payment-specific history query. Maintain aggregate queries for dashboard counts instead of fetching all rows. Add indexes that match the real query shapes.

**Acceptance tests:** insert more than 500 events and verify an old payment's complete history remains accessible; page through records with matching timestamps without skips or duplicates; measure query plans and response sizes with a reproducible large fixture. This is a necessary backend companion to the current client-side UI filters.

## 4. Strengthen identity and workspace boundaries

**Current code:** seeded shared demo passwords, a single workspace, synchronous `scryptSync` login work, session cookies, and an in-memory per-IP throttle. Role checks exist, but there is no organization membership model.

**Change:** for a shared hosted product, add an identity provider or an explicit account lifecycle with invitations, credential rotation and recovery. Model organization membership, scope every resource query and mutation to it, and test object-level authorization. Move password hashing off the event loop if local passwords remain. Use a bounded shared throttle with explicit trusted-proxy configuration; keep HTTPS-only cookies enabled for hosted use.

**Acceptance tests:** a member of workspace A cannot read, review, or retry a payment from B even with a known ID; role revocation takes effect on active sessions; expensive failed logins do not block unrelated requests. Do not publish real identity credentials in a demo.

## 5. Add observability, stronger audit retention, and operational tests

**Current code:** `/api/health` always reports `ok`; unexpected errors are logged without correlation IDs. Audit rows cannot be changed through normal SQL writes because of triggers, but a database administrator can bypass that protection. Manual retry resets the job's attempt counter.

**Change:** add structured logs with request, payment, and worker-attempt IDs; trace API → approval transaction → worker → provider; track queue age, attempts, reconciliation backlog, and confirmation latency. Separate liveness from readiness. Keep append-only attempt history across manual retry cycles. Export audit records to an independently controlled destination if stronger retention guarantees are required.

**Acceptance tests:** trace one timeout and its recovery end to end; deliberately stop the worker and detect an aging queue; prove that manual retries retain earlier attempt history; run a documented backup/restore exercise.

OpenTelemetry supplies traces, metrics, and logs as complementary signals; choose concrete operational questions before collecting them. [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/)

## Suggested next implementation

Start with **the provider interface, explicit reconciliation state, and a separate HTTP simulator**. Follow with **PostgreSQL and a two-worker crash-recovery test**. Together these make the project a stronger demonstration of payment correctness and distributed systems. Avoid splitting it into microservices until those boundaries and failure cases are proven.
