# Operations runbook

## Process and queue health

`/api/health` is liveness. `/api/ready` checks PostgreSQL, the HTTP simulator, and a worker heartbeat less than 15 seconds old when jobs exist. It returns 503 for an unavailable dependency or stale worker. Start separate roles with `PROCESS_ROLE=api npm start` and `npm run worker`; each worker gets its own lease-owner ID.

As an administrator, inspect System health or `/api/operations`: queue count, reconciliation count, overdue age, and confirmation latency. Unknown results require authoritative lookup, not a manual retry. Permanent declines remain terminal. Explicit pre-acceptance failures exhaust three attempts before an authorized retry can create a new cycle.

To exercise worker loss: approve a payment, stop its worker, wait past the lease, and start another. It looks up the stable provider key first. The stale worker cannot commit a later conflicting result. A started attempt with no outcome indicates an interruption or still-running request. The automated tests reproduce expired leases without waiting in real time.

## Logs and telemetry

Enable `OTEL_EXPORTER_OTLP_ENDPOINT` to export traces and metrics to your collector. API responses include `X-Request-Id`; audit and provider-attempt records preserve correlation IDs. Look for `payment.review`, `payment.process`, and `provider.post`/`provider.get` spans sharing a trace ID across queue processing and reconciliation. Metrics include `payment_attempts` and `payment_confirmation_ms`; the operations endpoint supplies organization-specific queue gauges. Structured JSON logs include event, request, trace, payment, worker, and outcome fields where applicable. Tokens/passwords and request bodies are not logged.

## Back up and restore

Use PostgreSQL client tools matching or newer than the server. Keep backup files and encryption keys in access-controlled storage. A PostgreSQL backup does not contain the provider’s independent receipt store; preserve that separately, because its idempotency records determine whether a remote operation already occurred.

```bash
pg_dump --dbname "$DATABASE_URL" --format=custom --file ledgerdesk.dump
# Create an EMPTY destination database with your database administration tooling.
pg_restore --dbname "$RESTORE_DATABASE_URL" --no-owner --exit-on-error ledgerdesk.dump
```

Start the restored application against `RESTORE_DATABASE_URL`. Startup verifies migration checksums. Check payment and history counts, confirm queued work is present, and perform provider lookups before relying on restored payment state. Restore provider receipts from a consistent SQLite backup using SQLite’s backup API (or copy the file only while the simulator is stopped); do not copy a live WAL database’s main file alone.

`tests/backup.test.ts` performs a real custom-format dump and restore into a randomized scratch database, verifies payment/history/migration preservation, and processes a restored queued job. `npm test` runs the exercise. The test uses synthetic data and drops only its generated database. It does not establish a recovery-time or recovery-point objective for a hosted service.

## External delivery and audit archive

Configure the authenticated receivers described in the README. Both require durable acknowledgement and idempotency handling. Delivery failure postpones the same encrypted outbox message with exponential backoff; expired claims can be reclaimed. Monitor undelivered outbox age in deployment monitoring. Keep `DELIVERY_KEY` stable across restarts and include it in controlled recovery procedures.

Audit export sends at most 100 ordered records per worker cycle and stores a destination-specific checkpoint after successful acceptance. Rejected/time-out responses repeat the same batch key. The destination controls retention and access independently. PostgreSQL append-only triggers protect normal application writes, not database superusers or compromised archive administration.
