import { deliver } from "./delivery.js";
import { exportAudit } from "./audit-export.js";
import { Database } from "./db.js";
import { Store } from "./domain.js";
import { createApp } from "./app.js";
import { Worker } from "./worker.js";
import { log, shutdownTelemetry } from "./telemetry.js";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  ["DATABASE_URL", "PROVIDER_TOKEN", "WEBHOOK_SECRET", "DELIVERY_KEY"].some(
    (key) => !process.env[key],
  )
)
  throw new Error(
    "Set DATABASE_URL, PROVIDER_TOKEN, WEBHOOK_SECRET, and DELIVERY_KEY for hosted use.",
  );
if (
  production &&
  process.env.SEED_DEMO === "true" &&
  !process.env.DEMO_PASSWORD
)
  throw new Error("Set DEMO_PASSWORD to seed a hosted demo.");
const db = new Database();
await db.migrate();
const store = new Store(db);
if (!production || process.env.SEED_DEMO === "true")
  await store.seed(
    process.env.DEMO_PASSWORD ?? "LedgerDemo!2026",
    process.env.SEED_EXAMPLES !== "false",
  );
const server =
  process.env.PROCESS_ROLE === "worker"
    ? undefined
    : createApp(store, {
        secureCookies: production || process.env.COOKIE_SECURE === "true",
        demo: process.env.SIMULATOR_CONTROLS !== "false",
      }).listen(
        Number(process.env.PORT ?? 3001),
        process.env.HOST ?? "127.0.0.1",
        () => log("server.started", { port: Number(process.env.PORT ?? 3001) }),
      );
const worker = new Worker(store);
let running: Promise<unknown> | undefined;
const timer =
  process.env.PROCESS_ROLE === "api"
    ? undefined
    : setInterval(() => {
        if (!running)
          running = (async () => {
            await worker.tick();
            await deliver(db);
            if (process.env.AUDIT_EXPORT_URL) {
              if (!process.env.AUDIT_EXPORT_TOKEN)
                throw new Error("Set AUDIT_EXPORT_TOKEN");
              await exportAudit(
                db,
                process.env.AUDIT_EXPORT_URL,
                process.env.AUDIT_EXPORT_TOKEN,
              );
            }
          })()
            .catch((e) => log("worker.error", { type: e.name, code: e.code }))
            .finally(() => {
              running = undefined;
            });
      }, 1000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await running;
  await db.close();
  await shutdownTelemetry();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
