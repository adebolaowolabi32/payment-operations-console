export type User = {
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
  status: "pending" | "queued" | "retrying" | "paid" | "failed" | "rejected";
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
  users: User[];
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
