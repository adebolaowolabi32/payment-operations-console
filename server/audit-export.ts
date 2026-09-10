import { Database, one } from "./db.js";
import { hash } from "./security.js";
/** Remote destination must persist a batch before returning 2xx and deduplicate its key. */
export async function exportAudit(db: Database, url: string, token: string) {
  const destination = hash(url),
    client = await db.pool.connect();
  try {
    const locked = await one(
      client,
      "SELECT pg_try_advisory_lock(hashtext($1)) locked",
      ["audit-export:" + destination],
    );
    if (!locked.locked) return 0;
    await client.query(
      "INSERT INTO audit_exports(destination) VALUES($1) ON CONFLICT DO NOTHING",
      [destination],
    );
    const checkpoint = await one(
      client,
      "SELECT last_id FROM audit_exports WHERE destination=$1",
      [destination],
    );
    // Identity sequence numbers can commit out of order. A brief SHARE lock waits for
    // concurrent audit inserts to commit before choosing a complete committed prefix.
    await client.query("BEGIN");
    await client.query("LOCK TABLE audit IN SHARE MODE");
    const rows = (
      await client.query(
        "SELECT * FROM audit WHERE id>$1 ORDER BY id LIMIT 100",
        [checkpoint.last_id],
      )
    ).rows;
    await client.query("COMMIT");
    if (!rows.length) return 0;
    const last = rows.at(-1).id;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "Idempotency-Key": `audit-${destination}-${checkpoint.last_id}-${last}`,
      },
      body: JSON.stringify({
        after: checkpoint.last_id,
        through: last,
        events: rows,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Audit destination rejected batch");
    await client.query(
      "UPDATE audit_exports SET last_id=$1 WHERE destination=$2",
      [last, destination],
    );
    return rows.length;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.query("SELECT pg_advisory_unlock_all()");
    client.release();
  }
}
