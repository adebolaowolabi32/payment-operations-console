import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { fixture, maker, checker, input } from "./helpers.js";
import { Worker } from "../server/worker.js";
import { span } from "../server/telemetry.js";
test("approval trace context follows a queued payment through timeout and reconciliation", async (t) => {
  const spans: any[] = [];
  const sdk = new NodeSDK({
    traceExporter: {
      export(batch, result) {
        spans.push(...batch);
        result({ code: 0 });
      },
      async shutdown() {},
    },
  });
  sdk.start();
  const { store, advance } = await fixture(t);
  const p = await store.create(maker, input, randomUUID());
  await store.review(checker, p.id, "approve", 1);
  const persisted = await store.payment(maker, p.id);
  assert.match(persisted.trace_context.traceparent, /^00-/);
  const worker = new Worker(store, {
    submit: () =>
      span("provider.submit", {}, async () => ({
        kind: "unknown",
        detail: "Response lost",
      })),
    lookup: () =>
      span("provider.lookup", {}, async () => ({
        kind: "confirmed",
        receipt: "receipt",
        providerRequestId: "provider",
      })),
  });
  await worker.tick();
  advance();
  await worker.tick();
  await sdk.shutdown();
  const approval = spans.find((s) => s.name === "payment.review");
  assert.ok(approval);
  const processing = spans.filter((s) => s.name === "payment.process");
  assert.equal(processing.length, 2);
  for (const s of [
    ...processing,
    ...spans.filter((s) => s.name.startsWith("provider.")),
  ])
    assert.equal(s.spanContext().traceId, approval.spanContext().traceId);
  assert.equal((await store.payment(maker, p.id)).status, "paid");
});
