export const money = (n: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(n / 100);
export const date = (n: number) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(n);
export const statusNames: Record<string, string> = {
  pending: "Awaiting approval",
  queued: "Queued",
  retrying: "Retry scheduled",
  paid: "Paid",
  reconciling: "Confirming outcome",
  declined: "Declined",
  failed: "Needs attention",
  rejected: "Rejected",
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const res = await fetch("/api" + url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "LedgerDesk",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed.");
  return data;
}
