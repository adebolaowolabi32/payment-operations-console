import { propagation, context } from "@opentelemetry/api";
import { span } from "./telemetry.js";
export type ProviderResult =
  | { kind: "confirmed"; receipt: string; providerRequestId: string }
  | {
      kind: "declined" | "unavailable" | "unknown" | "not_found";
      detail: string;
      providerRequestId?: string;
    };
export type ProviderPayment = {
  id: string;
  org_id: string;
  amount: number;
  beneficiary_id: string;
};
export interface PaymentProvider {
  submit(
    payment: ProviderPayment,
    key: string,
    mode: string,
  ): Promise<ProviderResult>;
  lookup(key: string, mode: string): Promise<ProviderResult>;
}
export class HttpProvider implements PaymentProvider {
  constructor(
    public url = process.env.PROVIDER_URL ?? "http://127.0.0.1:3003",
    private token = process.env.PROVIDER_TOKEN ?? "local-provider-demo-key",
    private timeout = Number(process.env.PROVIDER_TIMEOUT_MS ?? 800),
  ) {}
  private async call(
    path: string,
    method: string,
    body: unknown,
    mode: string,
  ): Promise<ProviderResult> {
    return span(
      "provider." + method.toLowerCase(),
      { provider: "simulator" },
      async () => {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: "Bearer " + this.token,
            "X-Simulator-Mode": mode,
          };
          propagation.inject(context.active(), headers);
          const response = await fetch(this.url + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout),
          });
          if (!response.ok)
            return {
              kind: method === "POST" ? "unknown" : "unavailable",
              detail: "Provider HTTP " + response.status,
            };
          const value = await response.json();
          if (
            value.kind === "confirmed" &&
            typeof value.receipt === "string" &&
            typeof value.providerRequestId === "string"
          )
            return value;
          if (
            ["declined", "unavailable", "unknown", "not_found"].includes(
              value.kind,
            ) &&
            typeof value.detail === "string"
          )
            return value;
          return { kind: "unknown", detail: "Malformed provider response." };
        } catch {
          return {
            kind: method === "POST" ? "unknown" : "unavailable",
            detail:
              method === "POST"
                ? "Submission outcome is unknown. Reconciliation required."
                : "Provider lookup is unavailable.",
          };
        }
      },
    );
  }
  submit(payment: ProviderPayment, key: string, mode: string) {
    return this.call("/transfers", "POST", { payment, key }, mode);
  }
  lookup(key: string, mode: string) {
    return this.call(
      "/transfers/" + encodeURIComponent(key),
      "GET",
      undefined,
      mode,
    );
  }
  async healthy() {
    try {
      return (
        await fetch(this.url + "/health", { signal: AbortSignal.timeout(1000) })
      ).ok;
    } catch {
      return false;
    }
  }
}
