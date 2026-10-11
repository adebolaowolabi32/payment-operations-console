# Backend implementation status

The five improvements proposed after the UI refresh are implemented:

| Area                     | Implementation                                                                                                                                                    | Evidence                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Provider reconciliation  | Separate HTTP simulator; distinct declined, unavailable, unknown, and confirmed results; lookup before recovering expired claims; signed callbacks                | Real HTTP timeout + provider restart, unavailable lookup, duplicate/reordered callback tests            |
| PostgreSQL and workers   | Checksum-verified migrations, transactional outbox, atomic leased claims, ownership/version fencing, jittered retries                                             | Concurrent claim, expired lease, stale completion, rollback, restart, and restore tests                 |
| Bounded reads            | Separate summary/list/detail/audit APIs, scoped cursor pagination, server search/sort, indexed payment history, UI paging                                         | Tied timestamp pagination, history beyond 500 global events, 10,000-row benchmark                       |
| Identity boundaries      | Organizations, live membership checks, invitations, password rotation/recovery, async scrypt, shared throttling, encrypted delivery outbox                        | Cross-workspace service tests, session revocation, one-time token tests, browser membership changes     |
| Operations and retention | Request IDs, OTLP traces/metrics, persisted trace context, immutable attempt starts/outcomes, readiness, queue diagnostics, external audit export, backup runbook | Timeout trace continuity, aging queue, retained retry history, export/delivery retries, pg_dump/restore |

Delivery and archive receivers are configurable external dependencies. Without their URLs, invitations/recovery remain queued and audit remains in PostgreSQL. Provision receivers and hosting separately. Measurements describe this project's simulated provider and local application.

Potential future work is load testing under realistic traffic, a production identity provider, fully managed mail delivery, automated point-in-time recovery, and independently operated archival retention. These are deployment/product extensions beyond this demo’s implemented backend upgrade.
