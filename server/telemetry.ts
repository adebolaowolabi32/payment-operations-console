import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  context,
  trace,
  propagation,
  metrics,
  SpanStatusCode,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
const sdk = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "ledgerdesk",
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 10000,
      }),
    })
  : undefined;
sdk?.start();
const storage = new AsyncLocalStorage<{ requestId: string }>();
export const requestId = () => storage.getStore()?.requestId ?? randomUUID();
export function withRequest<T>(id: string, fn: () => T) {
  return storage.run({ requestId: id }, fn);
}
export function log(event: string, fields: Record<string, unknown> = {}) {
  if (process.env.LOG_SILENT === "true") return;
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      event,
      requestId: requestId(),
      traceId: trace.getSpan(context.active())?.spanContext().traceId,
      ...fields,
    }),
  );
}
export function captureContext() {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}
export async function span<T>(
  name: string,
  attrs: Record<string, string | number>,
  fn: () => Promise<T>,
  carrier?: Record<string, string>,
): Promise<T> {
  const parent = carrier
    ? propagation.extract(context.active(), carrier)
    : context.active();
  return context.with(parent, () =>
    trace
      .getTracer("ledgerdesk")
      .startActiveSpan(name, { attributes: attrs }, async (s) => {
        try {
          return await fn();
        } catch (e) {
          s.recordException(e as Error);
          s.setStatus({ code: SpanStatusCode.ERROR });
          throw e;
        } finally {
          s.end();
        }
      }),
  );
}
export const attemptCounter = metrics
  .getMeter("ledgerdesk")
  .createCounter("payment_attempts");
export const confirmationTime = metrics
  .getMeter("ledgerdesk")
  .createHistogram("payment_confirmation_ms");
export async function shutdownTelemetry() {
  await sdk?.shutdown();
}
