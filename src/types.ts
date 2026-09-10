export type User = {
  org_id: string;
  org_name?: string;
  id: string;
  name: string;
  email: string;
  role: "maker" | "checker" | "admin" | "viewer";
};
export type Payment = {
  id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  bank: string;
  account_suffix: string;
  amount: number;
  reference: string;
  status:
    | "pending"
    | "queued"
    | "retrying"
    | "paid"
    | "failed"
    | "rejected"
    | "reconciling"
    | "declined";
  created_by: string;
  creator_name: string;
  reviewer_name: string | null;
  reviewed_by: string | null;
  reason: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  attempts: number | null;
  next_at: number | null;
  last_error: string | null;
  receipt: string | null;
};
export type Audit = {
  id: number;
  payment_id: string | null;
  actor_name: string;
  action: string;
  detail: string;
  created_at: number;
};
export type Workspace = {
  user: User;
  memberships: { id: string; name: string; role: User["role"] }[];
  summary: {
    total: number;
    amount: number;
    byStatus: Record<string, { count: number; amount: number }>;
  };
  paymentCursor: string | null;
  auditCursor: string | null;
  beneficiaryCursor: string | null;
  payments: Payment[];
  beneficiaries: {
    id: string;
    name: string;
    bank: string;
    account_suffix: string;
    category: string;
  }[];
  audit: Audit[];
  providerMode: string;
  serverTime: number;
};

export type Page<T> = { items: T[]; nextCursor: string | null };
export type Attempt = {
  id: number;
  operation: string;
  outcome: string;
  detail: string;
  started_at: number;
  stale: boolean;
  request_id: string;
};
