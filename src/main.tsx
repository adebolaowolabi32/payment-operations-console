import { api, ApiError, money, date, statusNames } from "./lib";
import {
  Badge,
  Modal,
  CreatePayment,
  PaymentProgress,
  MobilePayments,
} from "./components";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  CreditCard,
  FileClock,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  X,
  AlertTriangle,
  Activity,
  Menu,
} from "lucide-react";
import type { Payment, Workspace } from "./types";
import "./styles.css";
import "./experience.css";
const people = [
  {
    name: "Maya",
    email: "maya@ledgerdesk.demo",
    role: "Maker",
    desc: "Create payments",
  },
  {
    name: "Daniel",
    email: "daniel@ledgerdesk.demo",
    role: "Checker",
    desc: "Approve & reject",
  },
  {
    name: "Amara",
    email: "amara@ledgerdesk.demo",
    role: "Admin",
    desc: "Explore every workflow",
  },
  {
    name: "Alex",
    email: "alex@ledgerdesk.demo",
    role: "Viewer",
    desc: "Read-only access",
  },
];
function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(people[2].email);
  const [password, setPassword] = useState("LedgerDemo!2026");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/login", { email, password });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <Wallet size={23} />
          </span>
          LedgerDesk<span className="brand-dot">.</span>
        </div>
        <div>
          <p className="eyebrow">PAYMENT OPERATIONS, CONSIDERED.</p>
          <h1>
            Every payment.
            <br />A clear path
            <br />
            <em>forward.</em>
          </h1>
          <p>
            A workspace for careful approvals, clear accountability, and
            reliable payment processing.
          </p>
          <div className="login-pills">
            <span>
              <ShieldCheck size={16} /> Independent approvals
            </span>
            <span>
              <FileClock size={16} /> Traceable decisions
            </span>
          </div>
        </div>
        <p className="byline">
          An engineering portfolio project by Cynthia Owolabi
        </p>
      </section>
      <section className="login-form">
        <div className="demo-label">INTERACTIVE DEMO · SYNTHETIC DATA</div>
        <h2>Welcome to your workspace</h2>
        <p className="muted">
          Choose a role and explore the payment lifecycle.
        </p>
        <div className="demo-roles">
          {people.map((p) => (
            <button
              key={p.email}
              className={email === p.email ? "selected" : ""}
              onClick={() => setEmail(p.email)}
            >
              <strong>
                {p.name} <span>{p.role}</span>
              </strong>
              <small>{p.desc}</small>
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "Signing in…" : "Enter workspace"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="login-note">
          Local demo password: <code>LedgerDemo!2026</code>
          <br />
          All companies and transactions are fictional. No real money moves.
        </p>
      </section>
    </main>
  );
}
function App() {
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("Overview");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [initialBeneficiary, setInitialBeneficiary] = useState<string>();
  const [sort, setSort] = useState("newest");
  const [syncError, setSyncError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number>();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api<Workspace>("/workspace"));
      setSyncError("");
      setLastSynced(Date.now());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      else
        setSyncError(
          "Could not refresh the workspace. Showing the last saved view.",
        );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [!!data, load]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!mobile) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobile(false);
        document.querySelector<HTMLButtonElement>(".mobile-toggle")?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [mobile]);
  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }
  if (loading)
    return (
      <div className="loading">
        <Wallet />
        <p>Opening LedgerDesk…</p>
      </div>
    );
  if (!data)
    return (
      <>
        <Login onLogin={() => void load()} />
        {error && (
          <p role="alert" className="toast error">
            {error}
          </p>
        )}
      </>
    );
  const user = data.user;
  const canCreate = ["maker", "admin"].includes(user.role);
  const canReview = ["checker", "admin"].includes(user.role);
  const pending = data.payments.filter((p) => p.status === "pending");
  const paid = data.payments.filter((p) => p.status === "paid");
  const attention = data.payments.filter((p) =>
    ["failed", "retrying"].includes(p.status),
  );
  const total = (ps: Payment[]) => ps.reduce((sum, p) => sum + p.amount, 0);
  const current = data.payments.find((p) => p.id === selected);
  const rows = data.payments.filter(
    (p) =>
      (page !== "Approvals" || p.status === "pending") &&
      (filter === "all" || p.status === filter) &&
      [p.beneficiary_name, p.reference, p.id]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  rows.sort((a, b) =>
    sort === "amount"
      ? b.amount - a.amount
      : sort === "oldest"
        ? a.created_at - b.created_at
        : b.created_at - a.created_at,
  );
  const nav = [
    { name: "Overview", icon: LayoutDashboard },
    { name: "Payments", icon: CreditCard },
    { name: "Approvals", icon: ShieldCheck },
    { name: "Beneficiaries", icon: Users },
    { name: "Audit trail", icon: FileClock },
    { name: "System health", icon: Activity },
  ];
  function navigate(name: string) {
    setPage(name);
    setSelected(null);
    setError("");
    setFilter("all");
    setSearch("");
    setMobile(false);
  }
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      {mobile && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={"sidebar " + (mobile ? "open" : "")}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-icon">
            <Wallet size={22} />
          </span>
          LedgerDesk<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">C</span>
          <div>
            <strong>Cedar Finance</strong>
            <small>Demo workspace</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              aria-current={page === name ? "page" : undefined}
              className={page === name ? "active" : ""}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              {name}
              {name === "Approvals" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sandbox">
            <span className="status-dot" />
            <strong>Sandbox environment</strong>
            <p>
              Explore freely.
              <br />
              No real funds are transferred.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((s) => s[0])
                .join("")}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <button
              className="icon-button"
              title="Sign out to switch roles"
              aria-label="Sign out"
              onClick={() =>
                void act(async () => {
                  await api("/logout", {});
                  setData(null);
                }, "")
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              aria-label="Toggle navigation"
              aria-expanded={mobile}
              aria-controls="workspace-sidebar"
              onClick={() => setMobile(!mobile)}
            >
              <Menu />
            </button>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <span className="top-demo">
            <span className="status-dot" /> DEMO MODE
          </span>
        </header>
        <main className="content" id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">CEDAR FINANCE / OPERATIONS</p>
              <h1>{page === "Overview" ? "Payment overview" : page}</h1>
              <p className="muted">
                {page === "Overview"
                  ? "A clear view of your payments. Every step accounted for."
                  : page === "Approvals"
                    ? "Review the details. Keep every decision accountable."
                    : page === "Payments"
                      ? "Track every payment from request to confirmation."
                      : page === "Audit trail"
                        ? "A chronological record of actions and payment decisions."
                        : page === "System health"
                          ? "Understand provider behavior and payment recovery."
                          : "Your saved recipients, ready for the next payment."}
              </p>
            </div>
            {canCreate &&
              ["Overview", "Payments", "Approvals"].includes(page) && (
                <button
                  className="primary"
                  onClick={() => {
                    setInitialBeneficiary(undefined);
                    setShowCreate(true);
                  }}
                >
                  <Plus size={17} />
                  New payment
                </button>
              )}
          </div>
          {syncError && (
            <div className="warning inline-alert" role="status">
              <span>{syncError}</span>
              <button className="text-button" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          )}
          {error && (
            <div className="error inline-alert" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {page === "Overview" && (
            <>
              <section className="stats" aria-label="Payment summary">
                <div className="stat">
                  <div>
                    <span>Total requested</span>
                    <span className="stat-icon">
                      <Wallet size={18} />
                    </span>
                  </div>
                  <strong>{money(total(data.payments))}</strong>
                  <small>
                    {data.payments.length} payments in this workspace
                  </small>
                </div>
                <div className="stat">
                  <div>
                    <span>Awaiting approval</span>
                    <span className="stat-icon amber">
                      <Clock3 size={18} />
                    </span>
                  </div>
                  <strong>{money(total(pending))}</strong>
                  <small>
                    <span className="little-dot amber" />
                    {pending.length} requests to review
                  </small>
                </div>
                <div className="stat">
                  <div>
                    <span>Successfully paid</span>
                    <span className="stat-icon green">
                      <CheckCheck size={18} />
                    </span>
                  </div>
                  <strong>{money(total(paid))}</strong>
                  <small>
                    <span className="little-dot green" />
                    {paid.length} confirmed payments
                  </small>
                </div>
                <div className="stat">
                  <div>
                    <span>Needs attention</span>
                    <span className="stat-icon rose">
                      <Activity size={18} />
                    </span>
                  </div>
                  <strong>
                    {attention.length.toString().padStart(2, "0")}
                  </strong>
                  <small>Retrying or exhausted requests</small>
                </div>
              </section>
              <section className="approval-callout">
                <span className="callout-icon">
                  <ShieldCheck size={24} />
                </span>
                <div>
                  <h2>
                    {pending.length
                      ? `${pending.length} payments are waiting for a second pair of eyes`
                      : "Your approval queue is clear"}
                  </h2>
                  <p>
                    Every payment needs approval from someone other than its
                    creator.
                  </p>
                </div>
                <button onClick={() => navigate("Approvals")}>
                  Review queue
                  <ArrowRight size={17} />
                </button>
              </section>
            </>
          )}
          {["Overview", "Payments", "Approvals"].includes(page) && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {page === "Overview"
                      ? "Recent payments"
                      : page === "Approvals"
                        ? "Approval queue"
                        : "All payments"}{" "}
                    <span className="count">{rows.length}</span>
                  </h2>
                  <p>
                    {page === "Approvals"
                      ? canReview
                        ? "Select a payment to review its details."
                        : "Your role can view requests. A checker or admin can review them."
                      : "Live status across your payment workflow."}
                  </p>
                </div>
                <button
                  className="secondary small"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={14} />
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              <div className="table-toolbar">
                <div className="filter-controls">
                  {page !== "Approvals" && (
                    <label className="compact-select">
                      <span className="sr-only">Payment status</span>
                      <select
                        aria-label="Payment status"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All statuses</option>
                        {Object.entries(statusNames).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="compact-select">
                    <span className="sr-only">Sort payments</span>
                    <select
                      aria-label="Sort payments"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="amount">Highest amount</option>
                    </select>
                  </label>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search payments"
                    placeholder="Search payments…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <MobilePayments
                payments={rows}
                onSelect={(id) => {
                  setError("");
                  setSelected(id);
                }}
              />
              <div className="table-scroll desktop-payments">
                <table>
                  <thead>
                    <tr>
                      <th>BENEFICIARY</th>
                      <th>AMOUNT</th>
                      <th>STATUS</th>
                      <th>REQUESTED BY</th>
                      <th>DATE</th>
                      <th>
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="beneficiary-cell">
                            <span
                              className={
                                "recipient-icon " +
                                (p.beneficiary_id === "ben_north"
                                  ? "violet"
                                  : p.beneficiary_id === "ben_cloud"
                                    ? "blue"
                                    : "")
                              }
                            >
                              <ArrowUpRight size={18} />
                            </span>
                            <div>
                              <button
                                className="row-link"
                                onClick={() => setSelected(p.id)}
                              >
                                {p.beneficiary_name}
                              </button>
                              <small>{p.reference}</small>
                            </div>
                          </div>
                        </td>
                        <td className="amount">
                          {money(p.amount)}
                          <small>NGN</small>
                        </td>
                        <td>
                          <Badge status={p.status} />
                        </td>
                        <td>
                          <span className="mini-avatar">
                            {p.creator_name
                              .split(" ")
                              .map((s) => s[0])
                              .join("")}
                          </span>
                          {p.creator_name.split(" ")[0]}
                        </td>
                        <td className="date">{date(p.created_at)}</td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={
                              "View " + p.beneficiary_name + " payment"
                            }
                            onClick={() => setSelected(p.id)}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && (
                <div className="empty">
                  <Search size={28} />
                  <h3>
                    {search || filter !== "all"
                      ? "No payments match your filters"
                      : "You're all caught up"}
                  </h3>
                  <p>
                    {search || filter !== "all"
                      ? "Try another reference, beneficiary, or payment status."
                      : "New requests will appear here when they’re submitted."}
                  </p>
                  {(search || filter !== "all") && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setSearch("");
                        setFilter("all");
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              <div className="table-footer">
                <span>
                  {rows.length} of{" "}
                  {page === "Approvals" ? pending.length : data.payments.length}{" "}
                  payments
                </span>
                <span>
                  <ShieldCheck size={13} /> All amounts in Nigerian naira
                </span>
              </div>
            </section>
          )}
          {page === "Overview" && (
            <div className="bottom-grid">
              <section className="panel activity-panel">
                <div className="panel-heading">
                  <h2>Latest activity</h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("Audit trail")}
                  >
                    View audit trail <ArrowUpRight size={14} />
                  </button>
                </div>
                <AuditList events={data.audit.slice(0, 4)} />
              </section>
              <section className="panel flow-panel">
                <p className="eyebrow">BUILT-IN ACCOUNTABILITY</p>
                <h2>
                  One request.
                  <br />
                  Two independent decisions.
                </h2>
                <p>
                  Create, review, and process. Every step leaves a record you
                  can follow.
                </p>
                <div className="flow">
                  <span>
                    <Plus size={15} />
                    Request
                  </span>
                  <ChevronRight size={14} />
                  <span>
                    <ShieldCheck size={15} />
                    Review
                  </span>
                  <ChevronRight size={14} />
                  <span>
                    <Check size={15} />
                    Pay
                  </span>
                </div>
                <p className="flow-note">
                  Signed in as <strong>{user.role}</strong>. Sign out to explore
                  another role.
                </p>
              </section>
            </div>
          )}
          {page === "Beneficiaries" && (
            <section className="beneficiary-grid">
              {data.beneficiaries.map((b) => (
                <article className="panel beneficiary-card" key={b.id}>
                  <span className="recipient-icon">
                    <Users size={20} />
                  </span>
                  <h2>{b.name}</h2>
                  <p>{b.category}</p>
                  <hr />
                  <dl>
                    <dt>Bank</dt>
                    <dd>{b.bank}</dd>
                    <dt>Account</dt>
                    <dd>•••• {b.account_suffix}</dd>
                  </dl>
                  {canCreate && (
                    <button
                      className="secondary full"
                      onClick={() => {
                        setInitialBeneficiary(b.id);
                        setShowCreate(true);
                      }}
                    >
                      Create a payment
                      <ArrowUpRight size={15} />
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}
          {page === "Audit trail" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Workspace activity</h2>
                  <p>
                    Latest {data.audit.length} events · newest first · up to 500
                    shown
                  </p>
                </div>
                <FileClock size={21} />
              </div>
              <AuditList events={data.audit} />
            </section>
          )}
          {page === "System health" && (
            <div className="health-grid">
              <section className="panel health-card">
                <span className="stat-icon green">
                  <Activity />
                </span>
                <h2>Payment provider simulator</h2>
                <p>
                  Current mode:{" "}
                  <strong>
                    {data.providerMode === "healthy"
                      ? "Healthy"
                      : data.providerMode === "offline"
                        ? "Unavailable"
                        : "Accept, then time out once"}
                  </strong>
                </p>
                <p className="muted">
                  Queued payments are processed automatically. A failed attempt
                  retries after 5 seconds, then 10 seconds. After three
                  attempts, an authorized reviewer can start a new retry cycle.
                </p>
                {user.role === "admin" ? (
                  <label>
                    Simulator behavior
                    <select
                      value={data.providerMode}
                      disabled={busy}
                      onChange={(e) =>
                        void act(
                          () => api("/provider", { mode: e.target.value }),
                          "Provider simulator updated.",
                        )
                      }
                    >
                      <option value="healthy">
                        Healthy — confirm payments
                      </option>
                      <option value="offline">
                        Unavailable — exercise bounded retries
                      </option>
                      <option value="timeout_once">
                        Accept, then time out — exercise reconciliation
                      </option>
                    </select>
                  </label>
                ) : (
                  <p className="info">
                    Sign in as Amara (admin) to change simulator behavior.
                  </p>
                )}
              </section>
              <section className="panel health-card">
                <ShieldCheck className="green-text" />
                <h2>What this demo enforces</h2>
                <ul className="checks">
                  <li>
                    <Check />
                    Server-side role permissions
                  </li>
                  <li>
                    <Check />
                    No self-approval, including admins
                  </li>
                  <li>
                    <Check />
                    Duplicate-request protection
                  </li>
                  <li>
                    <Check />
                    Persistent queue and bounded retries
                  </li>
                  <li>
                    <Check />
                    One simulated receipt per payment
                  </li>
                  <li>
                    <Check />
                    Append-only audit records
                  </li>
                </ul>
                <p className="muted">
                  This is a single-workspace, single-worker demo with a mock
                  provider, not a connection to a bank.
                </p>
              </section>
            </div>
          )}
          <footer className="content-footer">
            <span>
              <span className={"status-dot " + (syncError ? "offline" : "")} />{" "}
              {syncError
                ? "Updates paused · reconnecting"
                : "Updated " + (lastSynced ? date(lastSynced) : "just now")}
            </span>
            <span>Designed & built by Cynthia Owolabi</span>
          </footer>
        </main>
      </div>
      {showCreate && (
        <CreatePayment
          data={data}
          initialBeneficiary={initialBeneficiary}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
            setNotice("Payment submitted for independent approval.");
          }}
        />
      )}
      {current && (
        <PaymentDetail
          payment={current}
          data={data}
          busy={busy}
          error={error}
          onClose={() => setSelected(null)}
          onReview={(action, reason) =>
            void act(
              () =>
                api("/payments/" + current.id + "/review", {
                  action,
                  version: current.version,
                  reason,
                }),
              action === "approve"
                ? "Payment approved and queued."
                : "Payment rejected.",
            )
          }
          onRetry={() =>
            void act(
              () => api("/payments/" + current.id + "/retry", {}),
              "Payment queued for another retry cycle.",
            )
          }
        />
      )}{" "}
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
    </div>
  );
}
function AuditList({ events }: { events: Workspace["audit"] }) {
  return (
    <ol className="audit-list">
      {events.map((a) => (
        <li key={a.id}>
          <span className="audit-icon">
            {a.action.includes("rejected") || a.action.includes("failed") ? (
              <AlertTriangle size={15} />
            ) : a.action.includes("approved") ? (
              <ShieldCheck size={15} />
            ) : a.action.includes("paid") ? (
              <CheckCheck size={15} />
            ) : (
              <FileClock size={15} />
            )}
          </span>
          <div>
            <strong>
              {a.action.replaceAll(".", " ").replaceAll("_", " ")}
            </strong>
            <p>{a.detail}</p>
            <small>
              {a.actor_name}
              {a.payment_id ? " · " + a.payment_id.slice(0, 12) : ""}
            </small>
          </div>
          <time dateTime={new Date(a.created_at).toISOString()}>
            {date(a.created_at)}
          </time>
        </li>
      ))}
      {!events.length && <li>No activity yet.</li>}
    </ol>
  );
}
function PaymentDetail({
  payment: p,
  data,
  busy,
  error,
  onClose,
  onReview,
  onRetry,
}: {
  payment: Payment;
  data: Workspace;
  busy: boolean;
  error: string;
  onClose: () => void;
  onReview: (action: "approve" | "reject", reason?: string) => void;
  onRetry: () => void;
}) {
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState("");
  const canReview = ["admin", "checker"].includes(data.user.role);
  return (
    <Modal title="Payment details" onClose={onClose} busy={busy}>
      <div className="modal-body">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="detail-hero">
          <span className="recipient-icon">
            <ArrowUpRight />
          </span>
          <p>{p.beneficiary_name}</p>
          <h2>{money(p.amount)}</h2>
          <Badge status={p.status} />
        </div>
        <PaymentProgress payment={p} />
        <dl className="detail-grid">
          <dt>Reference</dt>
          <dd>{p.reference}</dd>
          <dt>Recipient bank</dt>
          <dd>
            {p.bank} · •••• {p.account_suffix}
          </dd>
          <dt>Requested by</dt>
          <dd>{p.creator_name}</dd>
          <dt>Reviewed by</dt>
          <dd>{p.reviewer_name ?? "Awaiting independent review"}</dd>
          <dt>Created</dt>
          <dd>{date(p.created_at)}</dd>
          <dt>Payment ID</dt>
          <dd className="mono">{p.id}</dd>
          {p.attempts !== null && (
            <>
              <dt>Processing attempts</dt>
              <dd>{p.attempts} / 3</dd>
            </>
          )}
          {p.status === "paid" && p.receipt && (
            <>
              <dt>Provider receipt</dt>
              <dd className="mono">{p.receipt}</dd>
            </>
          )}
        </dl>
        {p.reason && <p className="info">Rejection reason: {p.reason}</p>}
        {p.last_error && <p className="warning">{p.last_error}</p>}
        {p.status === "pending" &&
          (p.created_by === data.user.id ? (
            <p className="info">
              <ShieldCheck size={18} />
              You created this payment. Ask another checker to review it.
            </p>
          ) : canReview ? (
            <div className="review-controls">
              {reject && (
                <label>
                  Reason for rejection
                  <textarea
                    minLength={5}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain what needs to change…"
                  />
                </label>
              )}
              <div className="modal-actions">
                <button
                  className="danger secondary"
                  disabled={busy || (reject && reason.trim().length < 5)}
                  onClick={() =>
                    reject ? onReview("reject", reason) : setReject(true)
                  }
                >
                  {reject ? "Confirm rejection" : "Reject payment"}
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    reject ? setReject(false) : onReview("approve")
                  }
                >
                  <Check size={16} />
                  {busy
                    ? "Saving…"
                    : reject
                      ? "Cancel rejection"
                      : "Approve payment"}
                </button>
              </div>
            </div>
          ) : (
            <p className="info">A checker or admin must review this payment.</p>
          ))}
        {p.status === "failed" && canReview && (
          <button className="primary full" disabled={busy} onClick={onRetry}>
            <RefreshCw size={16} />
            Retry payment
          </button>
        )}
        <h3 className="detail-history">Payment history</h3>
        <AuditList events={data.audit.filter((a) => a.payment_id === p.id)} />
      </div>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
