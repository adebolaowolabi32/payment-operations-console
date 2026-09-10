import { randomUUID } from "node:crypto";
import { Database, one } from "./db.js";
import { decrypt } from "./security.js";
import { log } from "./telemetry.js";
/** The receiver must deduplicate Idempotency-Key before sending email. */
export async function deliver(
  db: Database,
  url = process.env.DELIVERY_URL,
  token = process.env.DELIVERY_TOKEN,
) {
  if (!url) return false;
  if (!token) throw new Error("Set DELIVERY_TOKEN when enabling delivery");
  const owner = randomUUID(),
    now = Date.now();
  const row = await db.tx((q) =>
    one(
      q,
      `WITH candidate AS (SELECT id FROM delivery_outbox WHERE delivered_at IS NULL AND next_at<=$1 AND (lease_until IS NULL OR lease_until<$1) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE delivery_outbox d SET lease_owner=$2,lease_until=$3,attempts=attempts+1 FROM candidate c WHERE d.id=c.id RETURNING d.*`,
      [now, owner, now + 30000],
    ),
  );
  if (!row) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "Idempotency-Key": "delivery-" + row.id,
      },
      body: JSON.stringify({
        id: row.id,
        recipient: row.recipient,
        kind: row.kind,
        ...JSON.parse(decrypt(row.payload)),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Delivery rejected");
    await db.query(
      "UPDATE delivery_outbox SET delivered_at=$1,lease_owner=NULL,lease_until=NULL WHERE id=$2 AND lease_owner=$3",
      [Date.now(), row.id, owner],
    );
    log("delivery.sent", { deliveryId: row.id });
  } catch {
    await db.query(
      "UPDATE delivery_outbox SET next_at=$1,lease_owner=NULL,lease_until=NULL WHERE id=$2 AND lease_owner=$3",
      [
        Date.now() + Math.min(1000 * 2 ** Math.min(row.attempts, 12), 3600000),
        row.id,
        owner,
      ],
    );
    log("delivery.retry", { deliveryId: row.id });
  }
  return true;
}
