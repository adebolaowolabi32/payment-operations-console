import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Store } from "./domain.js";
import { createApp } from "./app.js";
const dbPath = process.env.DB_PATH ?? "data/ledgerdesk.db";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const production = process.env.NODE_ENV === "production";
if (production && !process.env.DEMO_PASSWORD)
  throw new Error(
    "Set DEMO_PASSWORD for a hosted instance. This remains a synthetic payment demo.",
  );
const store = new Store(dbPath);
store.seed(
  process.env.DEMO_PASSWORD ?? "LedgerDemo!2026",
  process.env.SEED_EXAMPLES !== "false",
);
const app = createApp(store, {
  secureCookies: process.env.COOKIE_SECURE === "true",
  demo: process.env.SIMULATOR_CONTROLS !== "false",
});
const server = app.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      "LedgerDesk API: http://" +
        (process.env.HOST ?? "127.0.0.1") +
        ":" +
        (process.env.PORT ?? 3001),
    ),
);
const worker = setInterval(() => {
  try {
    store.tick();
  } catch (error) {
    console.error("Worker tick failed", error);
  }
}, 1000);
function stop() {
  clearInterval(worker);
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
