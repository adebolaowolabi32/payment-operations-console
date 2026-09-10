import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const path = process.env.PROVIDER_DB_PATH ?? "data/provider.db";
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS transfers(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,request_id TEXT NOT NULL);",
);
const app = express();
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
const token = process.env.PROVIDER_TOKEN ?? "local-provider-demo-key";
if (process.env.NODE_ENV === "production" && !process.env.PROVIDER_TOKEN)
  throw new Error("Set PROVIDER_TOKEN");
app.use((req, res, next) => {
  const actual = createHash("sha256")
    .update(req.get("Authorization") ?? "")
    .digest();
  const expected = createHash("sha256")
    .update("Bearer " + token)
    .digest();
  if (!timingSafeEqual(actual, expected)) {
    res.sendStatus(401);
    return;
  }
  next();
});
app.post("/transfers", async (req, res) => {
  const parsed = z
    .object({
      key: z.string().min(3).max(200),
      payment: z.object({
        id: z.string(),
        org_id: z.string(),
        amount: z.number().int().positive(),
        beneficiary_id: z.string(),
      }),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.sendStatus(400);
    return;
  }
  const { payment, key } = parsed.data;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(payment))
    .digest("hex");
  const existing = db.prepare("SELECT * FROM transfers WHERE key=?").get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      res
        .status(409)
        .json({ kind: "declined", detail: "Idempotency conflict." });
      return;
    }
    res.json({
      kind: "confirmed",
      receipt: existing.receipt,
      providerRequestId: existing.request_id,
    });
    return;
  }
  const mode = req.get("X-Simulator-Mode");
  if (mode === "offline") {
    res.json({
      kind: "unavailable",
      detail: "Simulator temporarily unavailable before acceptance.",
    });
    return;
  }
  if (mode === "decline") {
    res.json({
      kind: "declined",
      detail: "Simulator permanently declined this transfer.",
    });
    return;
  }
  const receipt = "sim_" + randomUUID(),
    providerRequestId = randomUUID();
  db.prepare("INSERT INTO transfers VALUES(?,?,?,?)").run(
    key,
    fingerprint,
    receipt,
    providerRequestId,
  );
  if (mode === "timeout_once" || mode === "lookup_offline")
    await new Promise((r) => setTimeout(r, 2000));
  if (!res.destroyed)
    res.json({ kind: "confirmed", receipt, providerRequestId });
});
app.get("/transfers/:key", (req, res) => {
  if (
    ["offline", "lookup_offline"].includes(req.get("X-Simulator-Mode") ?? "")
  ) {
    res.json({
      kind: "unavailable",
      detail: "Simulator status lookup is unavailable.",
    });
    return;
  }
  const row = db
    .prepare("SELECT * FROM transfers WHERE key=?")
    .get(req.params.key);
  res.json(
    row
      ? {
          kind: "confirmed",
          receipt: row.receipt,
          providerRequestId: row.request_id,
        }
      : {
          kind: "not_found",
          detail: "No transfer exists under this idempotency key.",
        },
  );
});
const server = app.listen(
  Number(process.env.PROVIDER_PORT ?? 3003),
  process.env.HOST ?? "127.0.0.1",
  () => console.log("Simulator listening"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
