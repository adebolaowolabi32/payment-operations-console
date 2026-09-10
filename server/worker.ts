import { randomUUID } from "node:crypto";
import { one } from "./db.js";
import { Store, type Payment } from "./domain.js";
import {
  type PaymentProvider,
  type ProviderResult,
  HttpProvider,
} from "./provider.js";
import {
  span,
  log,
  withRequest,
  attemptCounter,
  confirmationTime,
} from "./telemetry.js";
export type Claim = {
  payment_id: string;
  org_id: string;
  lease_owner: string;
  claim_version: number;
  lease_until: number;
  uncertain: boolean;
  attempts_cycle: number;
};
export class Worker {
  constructor(
    public store: Store,
    public provider: PaymentProvider = new HttpProvider(),
    public id = "worker_" + randomUUID(),
    public leaseMs = Number(process.env.LEASE_MS ?? 10000),
    public backoff = Number(process.env.RETRY_BASE_MS ?? 5000),
  ) {}
  async heartbeat() {
    await this.store.db.pool.query(
      "INSERT INTO worker_heartbeats VALUES($1,$2) ON CONFLICT(worker) DO UPDATE SET seen_at=$2",
      [this.id, this.store.now()],
    );
  }
  async claim(): Promise<Claim | undefined> {
    return this.store.db.tx(async (q) => {
      const now = this.store.now();
      return one<Claim>(
        q,
        `WITH candidate AS (SELECT payment_id FROM jobs WHERE done=false AND next_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_at,payment_id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs j SET uncertain=uncertain OR lease_owner IS NOT NULL,lease_owner=$2,lease_until=$3,claim_version=claim_version+1 FROM candidate c WHERE j.payment_id=c.payment_id RETURNING j.*`,
        [now, this.id, now + this.leaseMs],
      );
    });
  }
  async process(claim: Claim) {
    const p = await one<Payment>(
      this.store.db.pool,
      "SELECT * FROM payments WHERE id=$1",
      [claim.payment_id],
    );
    if (!p) return;
    const org = await one(
      this.store.db.pool,
      "SELECT provider_mode FROM organizations WHERE id=$1",
      [p.org_id],
    );
    const id = randomUUID(),
      started = this.store.now();
    return withRequest(id, () =>
      span(
        "payment.process",
        { payment: p.id, worker: this.id, claim: claim.claim_version },
        async () => {
          let operation = claim.uncertain ? "lookup" : "submit";
          let result: ProviderResult;
          const key = p.org_id + ":" + p.id;
          await this.store.db.query(
            "INSERT INTO attempts(org_id,payment_id,worker,claim_version,operation,outcome,detail,request_id,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
            [
              p.org_id,
              p.id,
              this.id,
              claim.claim_version,
              operation,
              "started",
              "Provider operation started; a missing completion may indicate an interrupted worker.",
              id,
              started,
            ],
          );
          try {
            result = claim.uncertain
              ? await this.provider.lookup(key, org.provider_mode)
              : await this.provider.submit(p, key, org.provider_mode);
            if (result.kind === "not_found") {
              operation = "lookup_then_submit";
              result = await this.provider.submit(p, key, org.provider_mode);
            }
          } catch {
            result = {
              kind: "unknown",
              detail: "Unexpected provider failure; outcome unresolved.",
            };
          }
          return this.complete(claim, p, result, operation, id, started);
        },
        p.trace_context,
      ),
    );
  }
  async complete(
    c: Claim,
    p: Payment,
    result: ProviderResult,
    operation: string,
    id: string,
    started: number,
  ) {
    return this.store.db.tx(async (q) => {
      const now = this.store.now();
      const locked = await one(
        q,
        "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
        [p.id],
      );
      const job = await one(
        q,
        "SELECT * FROM jobs WHERE payment_id=$1 FOR UPDATE",
        [p.id],
      );
      const stale =
        !job ||
        job.done ||
        job.lease_owner !== this.id ||
        job.claim_version !== c.claim_version ||
        job.lease_until <= now;
      await q.query(
        "INSERT INTO attempts(org_id,payment_id,worker,claim_version,operation,outcome,detail,request_id,provider_request_id,started_at,finished_at,stale) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          p.org_id,
          p.id,
          this.id,
          c.claim_version,
          operation,
          result.kind,
          result.kind === "confirmed" ? "Receipt confirmed" : result.detail,
          id,
          result.providerRequestId ?? null,
          started,
          now,
          stale,
        ],
      );
      attemptCounter.add(1, { outcome: result.kind, stale: String(stale) });
      log("provider.attempt", {
        paymentId: p.id,
        worker: this.id,
        outcome: result.kind,
        stale,
      });
      if (stale) return false;
      const attempts = job.attempts_cycle + 1;
      const uncertain =
        result.kind === "unknown" ||
        (job.uncertain && result.kind === "unavailable");
      const status =
        result.kind === "confirmed"
          ? "paid"
          : result.kind === "declined"
            ? "declined"
            : uncertain
              ? "reconciling"
              : attempts >= 3
                ? "failed"
                : "retrying";
      const done = ["paid", "declined", "failed"].includes(status);
      const delay = uncertain
        ? Math.min(this.backoff * 2 ** Math.min(attempts - 1, 6), 60000)
        : this.backoff * 2 ** (attempts - 1);
      const jitter =
        process.env.TEST_NO_JITTER === "true"
          ? 0
          : Math.floor(Math.random() * delay * 0.2);
      await q.query(
        "UPDATE jobs SET attempts_cycle=$1,next_at=$2,done=$3,uncertain=$4,lease_owner=NULL,lease_until=NULL,last_error=$5 WHERE payment_id=$6",
        [
          attempts,
          now + delay + jitter,
          done,
          uncertain,
          result.kind === "confirmed" ? null : result.detail,
          p.id,
        ],
      );
      await q.query(
        "UPDATE payments SET status=$1,receipt=$2,version=version+1,updated_at=$3 WHERE id=$4",
        [
          status,
          result.kind === "confirmed" ? result.receipt : locked.receipt,
          now,
          p.id,
        ],
      );
      await this.store.audit(
        q,
        p.org_id,
        "system",
        "payment." + status,
        result.kind === "confirmed"
          ? "Provider receipt confirmed. No real funds moved."
          : result.detail,
        p.id,
      );
      if (status === "paid") confirmationTime.record(now - p.created_at);
      return true;
    });
  }
  async tick() {
    await this.heartbeat();
    let count = 0;
    for (; count < 20; count++) {
      const claim = await this.claim();
      if (!claim) break;
      await this.process(claim);
      await this.heartbeat();
    }
    return count;
  }
}
