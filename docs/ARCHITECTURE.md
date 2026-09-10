# Design decisions and failure analysis

## Boundary and data model

The React frontend is a client of the Express API. Hiding a control is only a usability decision; every mutation independently checks the authenticated user's role in the domain layer. Users and roles come from the database, not from request payloads.

Payment state, review version, amount, beneficiary, creator, and reviewer are stored in SQLite. Payments have a database constraint preventing the creator from also being the reviewer. Requests cannot change their beneficiary or amount after submission; a rejected request must be replaced by a new request.

Amounts arrive as decimal strings and are converted by splitting whole and fractional components into integer kobo. The maximum permitted amount is NGN 99,999,999.99. The database also constrains positive integer amounts. NGN is the only currency in this demonstration.

## Atomic creation and approval

Creation stores the payment, audit event, and idempotency record in one `BEGIN IMMEDIATE` transaction. Keys are scoped to the actor. The fingerprint includes normalized minor units, beneficiary ID, and trimmed reference. Equivalent strings such as `10` and `10.00` share a fingerprint; changing the amount under an existing key returns HTTP 409.

Approval checks both the current state and the version the reviewer saw. The status change, reviewer, audit record, and outbox entry commit together. If enqueueing fails, the whole transaction rolls back. A stale second review fails with HTTP 409.

This addresses repeated submission, lost responses, and conflicting reviews within the supported single-process deployment. A real distributed service would also need transaction isolation choices and uniqueness constraints appropriate to its database and traffic.

## Retry and reconciliation

The worker runs every second and reads up to twenty due jobs. A first failure schedules another attempt five seconds later; a second failure schedules it ten seconds later. The third failure exhausts that cycle. A checker or admin can explicitly initiate another cycle.

A stable payment ID is also the mock provider's idempotency key. There is one receipt per payment ID. In the timeout scenario, the receipt commits before local payment confirmation. A later attempt reads that receipt and marks the payment paid, avoiding another simulated transfer.

The receipt and payment status intentionally do not share one transaction: this exposes the gap between remote acceptance and local confirmation. A crash after receipt creation can be reconciled on restart because the payment and job remain durable.

The receipt lookup is local and always available in this simulator. A real provider may offer neither reliable idempotency nor an immediately consistent status lookup. In that case an ambiguous timeout should enter reconciliation or manual investigation rather than assume success or blindly resubmit.

## Authentication and browser boundary

Passwords are salted and hashed with scrypt. Session tokens are random, stored only as SHA-256 hashes, and expire after eight hours. Cookies are HttpOnly and SameSite=Strict, with optional Secure for HTTPS deployments. Logout deletes the server-side session.

Mutations require a custom same-origin header; cross-site Fetch Metadata requests are rejected. No CORS policy grants cross-origin access. Responses include a Content Security Policy and clickjacking protections. API responses are not cached. JSON bodies are bounded and schema-validated.

Login throttling is per IP, in memory, and expires after one minute. It is intentionally basic; a shared hosted service needs proxy-aware, distributed abuse controls and identity management.

## Tradeoffs

| Choice                         | Benefit                                                            | Limitation                                              |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- |
| SQLite with a synchronous API  | No external services; straightforward transactions and persistence | Single process; blocking DB work limits throughput      |
| Outbox in the payment database | Approval cannot commit without durable work                        | No distributed leases or independent worker scaling     |
| Mock provider receipt table    | Deterministic timeout and restart tests                            | Does not model a real network or provider SLA           |
| Version check on review        | Prevents stale decisions                                           | Client must refresh after conflict                      |
| Append-only audit triggers     | Normal application writes cannot alter history                     | Database administrators can alter schema or files       |
| Three-second UI polling        | Simple live status without socket infrastructure                   | Polling cost and up to three seconds of display latency |

## Possible next increments

Add a PostgreSQL adapter and worker leases before scaling to multiple processes. Add tenant-scoped authorization and an identity provider before supporting multiple organizations. Add an explicit reconciliation state, signed webhook verification, and contract tests before connecting a real provider. These are future work, not current features.
