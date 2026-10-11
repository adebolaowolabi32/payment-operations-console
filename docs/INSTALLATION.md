# Install LedgerDesk

These instructions start a local demo with synthetic data. You need Git, Node.js 22.13+ (22.x) or 24+, npm, and PostgreSQL 16 or newer. The easiest database setup uses Docker Engine/Docker Desktop with Docker Compose. Keep all commands in the cloned project directory.

## 1. Download the project

```bash
git clone https://github.com/adebolaowolabi32/payment-operations-console.git
cd payment-operations-console
node --version
npm ci
```

If Node is older than the supported versions, install a supported LTS release before continuing. Node’s built-in SQLite is used only by the independent provider simulator.

## 2. Start PostgreSQL

```bash
docker compose up -d postgres
docker compose ps
```

Wait until the PostgreSQL service is healthy. The included Compose file binds only to local port 5432 and stores data in a named Docker volume. It creates a local demo database named `ledgerdesk` with username/password `ledgerdesk`.

Already have PostgreSQL? Create a **new, empty database** and a login that owns it using your database administration tool. Supply that connection in your terminal instead of starting Compose:

```bash
export DATABASE_URL='postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/YOUR_DATABASE'
```

In PowerShell, use `$env:DATABASE_URL = 'postgresql://...'`. Run this in each terminal that starts the app or a worker. The application reads environment variables; load any `.env` file explicitly before starting the process.

## 3. Start the application

```bash
npm run dev
```

This starts the React frontend, API/worker, and HTTP provider simulator together. Open **http://127.0.0.1:5173**. If Vite prints a different port, use the printed address. PostgreSQL migrations and fictional demo accounts are created automatically on first startup.

Choose a role on the login screen. The local password is `LedgerDemo!2026`. Start with Maya (maker), create a payment, then sign out and use Daniel (checker) to approve it. Transfers are simulated.

## Using a VM or remote server

The services listen on localhost. To open the demo in your laptop’s browser, run this on your laptop while the app runs on the VM:

```bash
ssh -L 5173:127.0.0.1:5173 YOUR_USER@YOUR_VM_ADDRESS
```

Then open http://127.0.0.1:5173 **on your laptop**. Vite proxies API calls, keeping PostgreSQL and the provider on private ports. If local port 5173 is occupied, use `-L 5174:127.0.0.1:5173` and browse localhost:5174.

## Run the compiled app

Build once, then use two terminals:

```bash
npm run build
npm run provider
```

In the second terminal, from the same project directory:

```bash
npm start
```

Open http://127.0.0.1:3001. For a remote VM, forward port 3001 with the same SSH pattern. `npm run worker` starts an additional payment worker. Set `PROCESS_ROLE=api` before `npm start` if workers should run separately.

## Verify the installation

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/ready
```

Expect `ok` and `ready`. Readiness can briefly be degraded before the first worker heartbeat. A provider connection error usually means the simulator is not running on port 3003.

For development checks:

```bash
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Tests need access to PostgreSQL. The backup test also needs `pg_dump`, `pg_restore`, and a test database role with `CREATEDB`. Install PostgreSQL client tools of the same or newer major version than your server. Use `TEST_DATABASE_URL` to point checks at a separate test database. Tests use uniquely named schemas and preserve application data.

## Stop and restart

Press Ctrl+C to stop the development processes. To stop the Compose database:

```bash
docker compose stop
```

Restart with `docker compose up -d postgres` and `npm run dev`. Your database volume and simulator receipts remain available. See the [backup runbook](OPERATIONS.md) before moving data.

## Troubleshooting

| Symptom                                   | What to check                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED` on 5432                    | PostgreSQL is running and healthy; `DATABASE_URL` uses the correct host/port.                                                                           |
| Database password authentication failed   | Use credentials for your own fresh demo database. Existing PostgreSQL instances use their own credentials.                       |
| Port 5432 is already allocated            | Use your existing PostgreSQL with a separate database, or change Compose’s host port and match it in `DATABASE_URL`. Do not stop an unrelated database. |
| `node:sqlite` cannot be imported          | Check the supported Node version.                                                                                                                       |
| Missing table or migration failure        | The database user owns the target schema and can create tables/functions. Startup errors report migration problems.                                     |
| API works but browser cannot reach the VM | Set up SSH forwarding and browse your laptop’s forwarded localhost port.                                                                                |
| Payments remain queued                    | Keep the API’s combined worker or a separate worker running, plus `npm run provider`. Check `/api/ready`.                                               |
| Invitation email does not arrive          | Configure `DELIVERY_URL` and `DELIVERY_TOKEN`; the local demo queues messages for a separately configured mail service.                                 |

This guide covers local installation. Hosted deployment additionally requires HTTPS, explicit secrets, account provisioning, and configured external services; see [configuration](../README.md#configuration) and [operations](OPERATIONS.md).
