# API reference

All responses are JSON. Errors use `{error}` and an `X-Request-Id` response header. Mutations require `X-Requested-With: LedgerDesk` and reject `Sec-Fetch-Site: cross-site`. Authenticated routes use the HttpOnly, SameSite=Strict `ledger_session` cookie. Production cookies are Secure. Callback requests instead use their own HMAC authentication.

## Identity

| Method | Path                      | Body / result                                                              |
| ------ | ------------------------- | -------------------------------------------------------------------------- |
| POST   | `/api/login`              | `{email,password}` → `{user}` and session cookie                           |
| POST   | `/api/logout`             | `{}` → revokes session                                                     |
| GET    | `/api/bootstrap`          | `{user,memberships,providerMode}`                                          |
| POST   | `/api/workspace/switch`   | `{orgId}` → changes current session workspace                              |
| POST   | `/api/password`           | `{current,next}` → rotates credentials and revokes all sessions            |
| GET    | `/api/members`            | Admin-only member list, at most 100                                        |
| POST   | `/api/members/:id`        | Admin-only `{role,active}`; preserve an active admin                       |
| POST   | `/api/invitations`        | Admin-only `{email,role}` → queues encrypted delivery                      |
| POST   | `/api/invitations/accept` | `{token,name,password}`; existing users must supply their current password |
| POST   | `/api/recovery/request`   | `{email}` → generic response for registered/unregistered emails            |
| POST   | `/api/recovery/complete`  | `{token,password}` → consumes token and revokes sessions                   |

New passwords require 12–200 characters. Invitations last 24 hours; recovery tokens last 30 minutes. One-time tokens are delivered through the configured adapter, never returned by these endpoints. Session lifetime is eight hours. Login and recovery endpoints use shared PostgreSQL rate limits.

## Reads

| GET path                     | Result                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `/api/summary`               | `{total,amount,byStatus:{[status]:{count,amount}}}`                           |
| `/api/payments`              | `{items,nextCursor}`; default 20, maximum 100                                 |
| `/api/payments/:id`          | Full current payment, recipient, reviewer, and job information                |
| `/api/payments/:id/history`  | Payment-specific `{items,nextCursor}` audit events                            |
| `/api/payments/:id/attempts` | Payment-specific started/outcome events, request/provider IDs, and stale flag |
| `/api/audit`                 | Workspace-wide `{items,nextCursor}` audit events                              |
| `/api/beneficiaries`         | `{items,nextCursor}`; default 50, maximum 100                                 |

All paginated endpoints accept `limit` and `cursor`. Payments also accept `status` (`all` or one of the states below), `search` (up to 120 characters), and `sort` (`newest`, `oldest`, `amount`). Reuse a returned cursor only with the same query and workspace. There is no legacy `/api/workspace` endpoint.

States: `pending`, `queued`, `retrying`, `reconciling`, `paid`, `declined`, `failed`, `rejected`. Amounts in responses are integer minor units (kobo).

## Payment mutations

`POST /api/payments` requires a maker/admin and an 8–100 character `Idempotency-Key` containing letters, digits, hyphens, or underscores:

```json
{
  "beneficiaryId": "ben_atlas",
  "amount": "1250.50",
  "reference": "September invoice"
}
```

The decimal string has at most two decimal places and ranges from 0.01 to 99,999,999.99 NGN. Equivalent numeric formatting under the same key returns the original payment. Changed details under that key return 409.

`POST /api/payments/:id/review` accepts `{action:"approve"|"reject",version,reason?}`. A checker/admin who did not create the payment can review it once. Rejection needs a 5–300 character reason. Concurrent or stale reviews return 409.

`POST /api/payments/:id/retry` accepts `{}`. Only checkers/admins can retry `failed` payments. Unknown and permanently declined outcomes cannot be manually retried. Earlier attempt events remain accessible.

## Provider and operations

`POST /api/provider` accepts `{mode}` for admins when simulator controls are enabled. Modes: `healthy`, `offline`, `timeout_once`, `lookup_offline`, `decline`.

`POST /api/provider/callback` accepts `{id,paymentId,amount,receipt,outcome:"confirmed"|"declined"}`. Supply `X-Provider-Timestamp` (13-digit epoch milliseconds, within five minutes) and `X-Provider-Signature` (hex HMAC-SHA256 over `timestamp + "." + rawBody`, using `WEBHOOK_SECRET`). Repeated event IDs are acknowledged without repeating the transition.

| GET path          | Meaning                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/api/health`     | Process liveness                                                                                                        |
| `/api/ready`      | Database/provider connectivity and recent worker heartbeat when jobs exist; 503 when degraded                           |
| `/api/operations` | Admin-only organization queue depth, reconciliation backlog, overdue age, attempt counts, and mean confirmation latency |

The provider protocol is authenticated HTTP: `POST /transfers` with `{payment,key}`, `GET /transfers/:key` for authoritative lookup, and `GET /health`. Unknown submission transport failures enter reconciliation. A stable key must return the original receipt after acceptance, including across provider restarts.
