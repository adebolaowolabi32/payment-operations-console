import type { Payment, User, Audit, Attempt, Workspace } from "./types";
import { ApiError } from "./lib";
export const portfolio = import.meta.env.MODE === "portfolio";
const storageKey = "ledgerdesk-portfolio-v1";
const users: User[] = [
  { id: "maya", name: "Maya Okafor", role: "maker" },
  { id: "daniel", name: "Daniel Bello", role: "checker" },
  { id: "amara", name: "Amara Johnson", role: "admin" },
  { id: "alex", name: "Alex Morgan", role: "viewer" },
].map((u) => ({
  ...u,
  email: `${u.id}@ledgerdesk.demo`,
  org_id: "demo",
  org_name: "Cedar Finance",
})) as User[];
const beneficiaries = [
  "Atlas Logistics",
  "Bloom Studio",
  "Cedar Supplies",
  "Northstar Energy",
  "Olive Technologies",
  "Summit Consulting",
].map((name, i) => ({
  id: `ben-${i}`,
  name,
  bank: ["Access Bank", "GTBank", "Zenith Bank"][i % 3],
  account_suffix: String(4201 + i),
  category: ["Logistics", "Services", "Supplies"][i % 3],
}));
type State = {
  user: string | null;
  mode: string;
  payments: Payment[];
  audit: Audit[];
  attempts: Record<string, Attempt[]>;
  keys: Record<string, string>;
};
function seed(): State {
  const now = Date.now();
  const payments = Array.from({ length: 28 }, (_, i): Payment => {
    const b = beneficiaries[i % beneficiaries.length];
    const status = (
      [
        "pending",
        "paid",
        "pending",
        "failed",
        "rejected",
        "paid",
        "declined",
      ] as const
    )[i % 7];
    return {
      id: `demo-payment-${i + 1}`,
      beneficiary_id: b.id,
      beneficiary_name: b.name,
      bank: b.bank,
      account_suffix: b.account_suffix,
      amount: (125000 + i * 37250) * 100,
      reference: `INV-2026-${String(1040 + i)}`,
      status,
      created_by: "maya",
      creator_name: users[0].name,
      reviewer_name: status === "pending" ? null : users[1].name,
      reviewed_by: status === "pending" ? null : "daniel",
      reason:
        status === "rejected" ? "Please correct the invoice reference." : null,
      version: 1,
      created_at: now - (i + 1) * 3600000,
      updated_at: now - i * 3600000,
      attempts: status === "failed" ? 3 : status === "paid" ? 1 : 0,
      next_at: null,
      last_error:
        status === "failed"
          ? "Simulated provider unavailable after three attempts."
          : null,
      receipt: status === "paid" ? `DEMO-RECEIPT-${i + 1}` : null,
    };
  });
  return {
    user: null,
    mode: "healthy",
    payments,
    audit: payments.map((p, i) => ({
      id: i + 1,
      payment_id: p.id,
      actor_name: "Demo fixture",
      action: `payment.${p.status}`,
      detail: "Recorded synthetic example.",
      created_at: p.updated_at,
    })),
    attempts: Object.fromEntries(
      payments.map((p) => [
        p.id,
        Array.from({ length: p.attempts || 0 }, (_, i) => ({
          id: i + 1,
          operation: "submit",
          outcome: p.status === "paid" ? "confirmed" : "unavailable",
          detail: "Recorded simulated provider response.",
          started_at: p.updated_at,
          stale: false,
          request_id: `${p.id}-attempt-${i + 1}`,
        })),
      ]),
    ),
    keys: {},
  };
}
let state = seed();
export let storageAvailable = true;
try {
  const saved = portfolio ? localStorage.getItem(storageKey) : null;
  if (saved) {
    const parsed = JSON.parse(saved);
    if (
      Array.isArray(parsed.payments) &&
      Array.isArray(parsed.audit) &&
      parsed.attempts &&
      parsed.keys &&
      (parsed.user === null || users.some((u) => u.id === parsed.user))
    )
      state = parsed;
  }
} catch {
  storageAvailable = false;
}
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    storageAvailable = false;
  }
}
export function resetDemo() {
  state = seed();
  save();
  window.location.reload();
}
function event(
  p: Payment,
  action: string,
  detail: string,
  actor = "Simulated provider",
) {
  state.audit.unshift({
    id: Math.max(0, ...state.audit.map((a) => a.id)) + 1,
    payment_id: p.id,
    actor_name: actor,
    action,
    detail,
    created_at: Date.now(),
  });
}
function advance() {
  for (const p of state.payments) {
    if (!p.next_at || p.next_at > Date.now()) continue;
    const lookup = p.status === "reconciling";
    if (!["queued", "retrying", "reconciling"].includes(p.status)) continue;
    p.attempts = (p.attempts || 0) + 1;
    if (lookup && state.mode === "lookup_offline") {
      p.next_at = Date.now() + 5000;
      continue;
    }
    if (lookup) {
      p.status = "paid";
    } else if (state.mode === "offline") {
      p.status = p.attempts >= 3 ? "failed" : "retrying";
    } else if (state.mode === "decline") {
      p.status = "declined";
    } else if (["lookup_offline", "timeout_once"].includes(state.mode)) {
      p.status = "reconciling";
    } else {
      p.status = "paid";
    }
    p.next_at = ["retrying", "reconciling"].includes(p.status)
      ? Date.now() + (p.status === "retrying" ? p.attempts * 5000 : 2000)
      : null;
    p.receipt = p.status === "paid" ? `DEMO-${p.id}` : null;
    p.last_error =
      p.status === "paid"
        ? null
        : p.status === "reconciling"
          ? "Simulated response lost; looking up existing receipt."
          : "Simulated provider " + p.status;
    p.updated_at = Date.now();
    p.version++;
    const attempts = (state.attempts[p.id] ||= []);
    attempts.push({
      id: attempts.length + 1,
      operation: lookup ? "lookup" : "submit",
      outcome: p.status,
      detail: p.last_error || "Simulated payment confirmed. No funds moved.",
      started_at: p.updated_at,
      stale: false,
      request_id: `${p.id}-${attempts.length + 1}`,
    });
    event(
      p,
      `payment.${p.status}`,
      p.last_error || "Simulated receipt confirmed.",
    );
  }
  save();
}
export async function demoApi<T>(
  url: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const result = route(
    url,
    body as Record<string, string | number> | undefined,
    key,
  );
  return structuredClone(result) as T;
}
function route(
  url: string,
  body?: Record<string, string | number>,
  key?: string,
): unknown {
  const u = new URL(url, "https://demo.invalid");
  const path = u.pathname;
  const fail = (status: number, message: string): never => {
    throw new ApiError(status, message);
  };
  if (path === "/login") {
    const user = users.find((u) => u.email === body?.email);
    if (!user) fail(400, "Choose one of the four demo roles.");
    state.user = user!.id;
    save();
    return {};
  }
  if (path === "/logout") {
    state.user = null;
    save();
    return {};
  }
  const user = users.find((u) => u.id === state.user);
  if (!user) return fail(401, "Choose a demo role to continue.");
  advance();
  function allow(roles: string[]) {
    if (!roles.includes(user!.role))
      fail(403, "This demo role cannot perform that action.");
  }
  function page<T>(items: T[]) {
    const start = Math.max(0, Number(u.searchParams.get("cursor")) || 0);
    const limit = 20;
    return {
      items: items.slice(start, start + limit),
      nextCursor: start + limit < items.length ? String(start + limit) : null,
    };
  }
  if (path === "/bootstrap")
    return {
      user,
      memberships: [{ id: "demo", name: "Cedar Finance", role: user.role }],
      providerMode: state.mode,
    };
  if (path === "/summary") {
    const byStatus: Workspace["summary"]["byStatus"] = {};
    for (const p of state.payments) {
      const entry = (byStatus[p.status] ||= { count: 0, amount: 0 });
      entry.count++;
      entry.amount += p.amount;
    }
    return {
      total: state.payments.length,
      amount: state.payments.reduce((n, p) => n + p.amount, 0),
      byStatus,
    };
  }
  if (path === "/beneficiaries") return page(beneficiaries);
  if (path === "/audit")
    return page([...state.audit].sort((a, b) => b.created_at - a.created_at));
  if (path === "/provider") {
    allow(["admin"]);
    if (
      ![
        "healthy",
        "offline",
        "decline",
        "lookup_offline",
        "timeout_once",
      ].includes(String(body?.mode))
    )
      fail(400, "Unknown simulator mode.");
    state.mode = String(body!.mode);
    save();
    return {};
  }
  if (path === "/operations")
    return {
      queued: state.payments.filter((p) =>
        ["queued", "retrying"].includes(p.status),
      ).length,
      reconciling: state.payments.filter((p) => p.status === "reconciling")
        .length,
      queue_age_ms: 0,
      mean_confirmation_ms: 2000,
    };
  if (path === "/payments" && !body) {
    const search = (u.searchParams.get("search") || "").toLowerCase(),
      status = u.searchParams.get("status");
    const items = state.payments.filter(
      (p) =>
        (!status || status === "all" || p.status === status) &&
        `${p.beneficiary_name} ${p.reference} ${p.id}`
          .toLowerCase()
          .includes(search),
    );
    items.sort((a, b) =>
      u.searchParams.get("sort") === "amount"
        ? b.amount - a.amount
        : u.searchParams.get("sort") === "oldest"
          ? a.created_at - b.created_at
          : b.created_at - a.created_at,
    );
    return page(items);
  }
  if (path === "/payments" && body) {
    allow(["maker", "admin"]);
    if (key && state.keys[key])
      return state.payments.find((p) => p.id === state.keys[key]);
    const b = beneficiaries.find((b) => b.id === body.beneficiaryId);
    const amount = Math.round(Number(body.amount) * 100),
      reference = String(body.reference || "").trim();
    if (
      !b ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 9999999999 ||
      reference.length < 3 ||
      reference.length > 120
    )
      return fail(400, "Enter a valid beneficiary, amount and reference.");
    const p: Payment = {
      id: crypto.randomUUID(),
      beneficiary_id: b.id,
      beneficiary_name: b.name,
      bank: b.bank,
      account_suffix: b.account_suffix,
      amount,
      reference,
      status: "pending",
      created_by: user.id,
      creator_name: user.name,
      reviewed_by: null,
      reviewer_name: null,
      reason: null,
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      attempts: 0,
      next_at: null,
      last_error: null,
      receipt: null,
    };
    state.payments.unshift(p);
    if (key) state.keys[key] = p.id;
    event(
      p,
      "payment.created",
      "Submitted for independent approval.",
      user.name,
    );
    save();
    return p;
  }
  const match = path.match(
    /^\/payments\/([^/]+)(?:\/(review|retry|history|attempts))?$/,
  );
  if (match) {
    const p = state.payments.find((p) => p.id === match[1]);
    if (!p) return fail(404, "Payment not found.");
    const action = match[2];
    if (!action) return p;
    if (action === "history")
      return page(
        state.audit
          .filter((a) => a.payment_id === p.id)
          .sort((a, b) => b.created_at - a.created_at),
      );
    if (action === "attempts")
      return page([...(state.attempts[p.id] || [])].reverse());
    allow(["admin", "checker"]);
    if (action === "review") {
      if (p.created_by === user.id)
        fail(403, "Another demo user must review this payment.");
      if (p.status !== "pending" || p.version !== body?.version)
        fail(409, "This payment has changed. Refresh and try again.");
      if (!["approve", "reject"].includes(String(body?.action)))
        fail(400, "Choose approve or reject.");
      if (
        body?.action === "reject" &&
        String(body.reason || "").trim().length < 3
      )
        fail(400, "Add a rejection reason.");
      p.status = body?.action === "approve" ? "queued" : "rejected";
      p.reviewed_by = user.id;
      p.reviewer_name = user.name;
      p.reason = p.status === "rejected" ? String(body?.reason) : null;
      event(
        p,
        p.status === "queued" ? "payment.approved" : "payment.rejected",
        p.reason || "Approved for simulated processing.",
        user.name,
      );
    } else {
      if (p.status !== "failed")
        fail(409, "Only failed payments can be retried.");
      p.status = "queued";
      p.attempts = 0;
      event(p, "payment.retried", "New simulated retry cycle.", user.name);
    }
    p.updated_at = Date.now();
    p.version++;
    p.next_at = p.status === "queued" ? Date.now() + 1200 : null;
    save();
    return p;
  }
  return fail(400, "This action is available in the full local application.");
}
