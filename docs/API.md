# API contract

All routes use JSON. Mutations require `X-Requested-With: LedgerDesk`. Authenticated calls use the `ledger_session` cookie returned by login. Errors are `{ "error": "Human-readable message" }`.

| Method | Route                      | Request                                                                         | Result                                                                |
| ------ | -------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/health`              | None                                                                            | Health status                                                         |
| POST   | `/api/login`               | `email`, `password`                                                             | User and session cookie                                               |
| POST   | `/api/logout`              | `{}`                                                                            | Revokes the session                                                   |
| GET    | `/api/workspace`           | Session                                                                         | User, beneficiaries, payments, latest 500 audit events, provider mode |
| POST   | `/api/payments`            | `beneficiaryId`, decimal-string `amount`, `reference`; `Idempotency-Key` header | Payment, HTTP 201                                                     |
| POST   | `/api/payments/:id/review` | `action` (`approve` or `reject`), integer `version`, `reason` for rejection     | Updated payment                                                       |
| POST   | `/api/payments/:id/retry`  | `{}`                                                                            | Requeues an exhausted payment                                         |
| POST   | `/api/provider`            | `mode`: `healthy`, `offline`, or `timeout_once`                                 | Admin-only simulator change                                           |

A repeated create with the same actor, key, and normalized payload returns the same payment (HTTP 201). A conflicting payload returns 409. Payment amounts in responses are integer kobo. Timestamps are Unix milliseconds. IDs are opaque strings.

## Local example

```sh
curl -c /tmp/ledger-cookies \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: LedgerDesk' \
  -d '{"email":"maya@ledgerdesk.demo","password":"LedgerDemo!2026"}' \
  http://127.0.0.1:3001/api/login

curl -b /tmp/ledger-cookies \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: LedgerDesk' \
  -H 'Idempotency-Key: example-invoice-001' \
  -d '{"beneficiaryId":"ben_atlas","amount":"1250.50","reference":"Example invoice"}' \
  http://127.0.0.1:3001/api/payments
```

The creator cannot review this payment. Sign in as an independent checker and use the payment's returned ID and current version for review. Version conflicts require refreshing the workspace.

Status codes: 400 invalid input, 401 missing/expired session or bad credentials, 403 role or request-origin violation, 404 missing resource, 409 state/idempotency conflict, 429 login throttle, 500 unexpected server error.
