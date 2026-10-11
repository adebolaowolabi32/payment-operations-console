# LedgerDesk

I built LedgerDesk to work through a common payment problem: a provider accepts a transfer, but its response never arrives. The app keeps that payment pending while it checks what happened. Retrying immediately could pay twice.

You can create a request and have another person approve it, then follow its processing history. The companies and payments are fictional. No real money moves.

**[Try the interactive demo](https://adebolaowolabi32.github.io/payment-operations-console/)**. No sign-up or installation.

![LedgerDesk portfolio preview](docs/portfolio-desktop.png)

## Interactive portfolio preview

The GitHub Pages preview runs entirely in your browser with fictional payments. Choose Maya to create a request, sign out and choose Daniel to approve it, or explore as Amara to change the simulated provider behavior. Search, filter, page through payments, inspect receipts and history, and reset the demo whenever you like.

Changes persist in this browser when local storage is available; restricted browsers use a temporary session. Processing advances while the workspace is open. Provider outcomes and queue metrics are simulated. The preview does not connect to a backend or move money. Its role switcher demonstrates the workflow; server-side permissions and account management are available in the local application. The full application below implements server-side permissions, PostgreSQL persistence, concurrent workers, and operational telemetry.

To run the same static preview locally:

```bash
npm ci
npm run build:portfolio
npm run preview:portfolio
# Open http://127.0.0.1:4174/payment-operations-console/
npm run test:portfolio
```

The Pages workflow builds and browser-tests the preview before deploying only `dist/`. Backend sources and local data are not part of the deployed site.

**New here? Follow the [installation guide](docs/INSTALLATION.md)** for cloning, database setup, VM access, troubleshooting, and verification.

## Run locally

Use Node.js 22.13+ (22.x) or 24+, npm, and PostgreSQL 16+. Docker Compose can start the database:

```bash
npm ci
docker compose up -d postgres
npm run dev
```

Open the Vite address printed in the terminal (normally http://127.0.0.1:5173). The API listens on 3001 and the separate provider simulator on 3003. `npm run dev` starts both services and Vite. Database migrations run at API/worker startup. The default database URL is `postgresql://ledgerdesk:ledgerdesk@127.0.0.1:5432/ledgerdesk`; set `DATABASE_URL` to use another local PostgreSQL instance.

For a compiled local demo:

```bash
npm run build
npm run provider
# In another terminal:
npm start
```

Open http://127.0.0.1:3001. For a second worker, run `npm run worker`. Use `PROCESS_ROLE=api npm start` to separate the API from background processing entirely.

The previous SQLite application database is not modified or imported. PostgreSQL starts a new seeded demo. The **provider simulator alone** uses its own SQLite receipt database (`data/provider.db`), independently of the application database.

## Explore

All seeded accounts use the local demo password `LedgerDemo!2026`:

| Account                | Role    | Can do                                              |
| ---------------------- | ------- | --------------------------------------------------- |
| maya@ledgerdesk.demo   | Maker   | Submit payments                                     |
| daniel@ledgerdesk.demo | Checker | Review and retry                                    |
| amara@ledgerdesk.demo  | Admin   | Manage members, simulator, payments, and workspaces |
| alex@ledgerdesk.demo   | Viewer  | Read workspace records                              |

1. Sign in as Maya and create a payment. Review its details before submitting.
2. Sign out and use Daniel to approve it. The provider confirms a simulated receipt.
3. Use Amara’s **System health** page to try an outage, permanent decline, or a response lost after acceptance.
4. Watch **Confirming outcome** payments reconcile. An unresolved payment cannot be manually resubmitted.
5. Switch Amara from Cedar Finance to Harbor Labs to see isolated payment records. Use **Account** to invite members, change roles, deactivate membership, or rotate a password.

The server handles filtering and sorting. Payment lists and history are paginated, while dashboard totals cover the whole workspace. On mobile, payments appear as cards. Unsubmitted drafts stay in place while you review them.

## How the backend handles payments

- **Independent approval:** administrators cannot approve their own requests. Version checks reject conflicting reviews.
- **Atomic writes:** approval, its audit event, and its processing job commit together. An insertion failure rolls back the transaction.
- **Idempotency:** equivalent request bodies under the same actor/workspace/key return the original payment; conflicting bodies fail. Every provider submission uses a stable workspace/payment key.
- **Concurrent workers:** atomic `SKIP LOCKED` claims, expiry, ownership, and claim versions prevent stale workers from changing payment state. An expired claim first reconciles with the provider. Remote idempotency remains necessary when workers overlap.
- **Explicit outcomes:** confirmed, permanent decline, pre-acceptance unavailability, and unknown outcomes have separate paths. Unavailable submissions get three attempts; uncertain outcomes keep reconciling with capped backoff and jitter. They never become safely retryable just because time passed.
- **Durable history:** started operations and their outcomes are separate append-only attempt events. Missing outcomes expose interrupted work; manual retry cycles preserve earlier events. Signed callbacks are deduplicated and cannot regress a terminal state.
- **Workspace boundaries:** each resource read and mutation checks current membership and organization. Sessions reflect role revocation immediately; credential changes invalidate all sessions.
- **Account lifecycle:** asynchronous scrypt, hashed session/recovery/invitation tokens, shared PostgreSQL throttling, one-time recovery, and encrypted delivery outbox records.
- **Operations:** correlated structured logs, persisted OpenTelemetry trace context, attempt/latency metrics, queue diagnostics, liveness/readiness, and retryable external audit export.

This remains an engineering demo. The application’s database owner can bypass SQL history triggers. Stronger retention requires an independently administered destination. The provider must honor stable idempotency keys and authoritative lookup semantics. Authentication delivery requires configuring a receiver; queueing an invitation by itself does not send an email.

## Delivery and audit retention

Set `DELIVERY_URL` and `DELIVERY_TOKEN` to an authenticated HTTP email-delivery adapter. The worker sends `{id, recipient, kind, token, org?}` with a stable `Idempotency-Key`. The adapter must durably accept and deduplicate the request before returning 2xx, then deliver the token privately to the recipient. Failed requests retry; tokens are encrypted at rest with `DELIVERY_KEY`. Recovery responses do not reveal whether an email is registered. Invitation acceptance and recovery forms are available on the sign-in screen.

Set `AUDIT_EXPORT_URL` and `AUDIT_EXPORT_TOKEN` to an independently controlled archive receiver. It receives ordered batches `{after, through, events}` and a stable `Idempotency-Key`. The export checkpoint advances only after 2xx. The receiver must persist and deduplicate batches before acknowledging them. Keep the archive credentials and retention administration separate from the application database owner. Delivery and export are disabled when their URLs are unset.

## Configuration

| Variable                                           | Purpose                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`, `DB_SCHEMA`                        | PostgreSQL connection and application schema (default `public`)   |
| `PROCESS_ROLE`                                     | `api`, `worker`, or combined when unset                           |
| `PORT`, `HOST`                                     | API listener; default 3001 / 127.0.0.1                            |
| `PROVIDER_URL`, `PROVIDER_TOKEN`                   | Simulator endpoint and shared authentication                      |
| `PROVIDER_PORT`, `PROVIDER_DB_PATH`                | Simulator listener and durable receipts                           |
| `PROVIDER_TIMEOUT_MS`                              | HTTP timeout, default 800ms                                       |
| `LEASE_MS`, `RETRY_BASE_MS`                        | Claim lease and initial retry delay, defaults 10000/5000ms        |
| `WEBHOOK_SECRET`                                   | HMAC callback verification secret                                 |
| `DELIVERY_KEY`, `DELIVERY_URL`, `DELIVERY_TOKEN`   | Encryption key and email adapter                                  |
| `AUDIT_EXPORT_URL`, `AUDIT_EXPORT_TOKEN`           | External audit archive                                            |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | Enable OTLP traces/metrics and name the service                   |
| `TRUST_PROXY`                                      | Explicit comma-separated trusted proxy addresses/subnets          |
| `COOKIE_SECURE`                                    | Set `true` behind local HTTPS; automatically true in production   |
| `SEED_DEMO`, `DEMO_PASSWORD`, `SEED_EXAMPLES`      | Hosted demo opt-in, explicit password, and sample payment control |
| `SIMULATOR_CONTROLS`                               | Set `false` to disable changing provider modes through the API    |
| `TEST_DATABASE_URL`                                | Isolated test database connection                                 |

Hosted use requires `DATABASE_URL`, `PROVIDER_TOKEN`, `WEBHOOK_SECRET`, and `DELIVERY_KEY`. Production does not seed accounts unless `SEED_DEMO=true`, which also requires an explicit `DEMO_PASSWORD`. Serve behind HTTPS and set only the proxies you actually trust. The displayed shared password is for the local synthetic demo.

## Validation

```bash
npm run format:check
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm run benchmark
```

Tests require PostgreSQL. The test role must create/drop schemas; the backup test additionally creates a uniquely named scratch database and needs `CREATEDB`, `pg_dump`, and `pg_restore`. The PostgreSQL client major version must be at least the server’s. Tests never reset the application schema: they create and remove randomized fixtures. Browser checks use separate API/provider ports (3002/3004) and a temporary schema and receipt database.

Tests exercise the failure paths that matter most here: a provider accepts a transfer but loses the response, a worker finishes after its claim expires, and a callback arrives twice. Other checks cover approval permissions, account recovery, delivery retries and database restoration. Browser tests follow payments from creation through approval on desktop and mobile. See the [backend implementation notes](docs/BACKEND-ROADMAP.md) for the coverage breakdown.

[Query benchmark](docs/QUERY-BENCHMARK.json) records a reproducible 10,000-payment fixture, bounded response bytes, and an actual PostgreSQL query plan. It is a local sample, not a production capacity estimate.

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Backend implementation status](docs/BACKEND-ROADMAP.md)
- [Operations and backup runbook](docs/OPERATIONS.md)

## Author

Built by [Cynthia Owolabi](https://github.com/adebolaowolabi32).

[Portfolio and experience](https://adebolaowolabi32.github.io/) · [Current CVs](https://adebolaowolabi32.github.io/resume.html)
