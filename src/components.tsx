import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import type { Payment, Workspace } from "./types";
import { api, money, date, statusNames } from "./lib";
export function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>
      <span />
      {statusNames[status] ?? status}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    const overflow = document.body.style.overflow;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    d?.showModal();
    return () => {
      d?.close();
      document.body.style.overflow = overflow;
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      aria-busy={busy}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <p className="eyebrow">PAYMENT WORKSPACE</p>
          <h2 id={id}>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function PaymentProgress({ payment: p }: { payment: Payment }) {
  const step =
    p.status === "pending"
      ? 0
      : p.status === "rejected"
        ? 1
        : p.status === "paid"
          ? 3
          : 2;
  return (
    <ol className="payment-progress" aria-label="Payment progress">
      {[
        "Requested",
        p.status === "rejected" ? "Rejected" : "Reviewed",
        p.status === "failed" ? "Needs attention" : "Processing",
        "Paid",
      ].map((label, i) => (
        <li
          key={i}
          className={i < step ? "complete" : i === step ? "current" : ""}
          aria-current={i === step ? "step" : undefined}
        >
          <span>{i < step ? <Check size={13} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
export function MobilePayments({
  payments,
  onSelect,
}: {
  payments: Payment[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mobile-payments">
      {payments.map((p) => (
        <button
          className="mobile-payment"
          key={p.id}
          onClick={() => onSelect(p.id)}
          aria-label={"View " + p.beneficiary_name + " payment " + p.reference}
        >
          <span className="mobile-payment-top">
            <span className="recipient-icon">
              <ArrowUpRight size={19} />
            </span>
            <span>
              <strong>{p.beneficiary_name}</strong>
              <small>{p.reference}</small>
            </span>
            <ChevronRight size={17} />
          </span>
          <span className="mobile-payment-values">
            <strong>{money(p.amount)}</strong>
            <Badge status={p.status} />
          </span>
          <span className="mobile-payment-meta">
            {p.creator_name} <span>{date(p.created_at)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
export function CreatePayment({
  data,
  initialBeneficiary,
  onClose,
  onCreated,
}: {
  data: Workspace;
  initialBeneficiary?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [beneficiaryId, setBeneficiary] = useState(
    initialBeneficiary ?? data.beneficiaries[0].id,
  );
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [step, setStep] = useState<"details" | "review">("details");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const key = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const beneficiary = data.beneficiaries.find((b) => b.id === beneficiaryId)!;
  const [whole, part = ""] = amount.split(".");
  const minor = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  useEffect(() => {
    if (step === "review") heading.current?.focus({ preventScroll: true });
  }, [step]);
  function changed() {
    key.current = crypto.randomUUID();
    setError("");
  }
  function close() {
    if (busy) return;
    if (amount || reference) setDiscard(true);
    else onClose();
  }
  function review(e: FormEvent) {
    e.preventDefault();
    if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(amount) || minor <= 0) {
      setError(
        "Enter an amount from ₦0.01 to ₦99,999,999.99, with at most two decimal places.",
      );
      return;
    }
    if (reference.trim().length < 3) {
      setError("Add a reference of at least 3 characters.");
      return;
    }
    setError("");
    setStep("review");
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/payments", { beneficiaryId, amount, reference }, key.current);
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create a payment" onClose={close} busy={busy}>
      <div className="composer-steps" aria-label="Payment creation steps">
        <span className={step === "details" ? "current" : "complete"}>
          <i>{step === "review" ? <Check size={12} /> : 1}</i>Payment details
        </span>
        <span className={step === "review" ? "current" : ""}>
          <i>2</i>Review & submit
        </span>
      </div>
      {discard ? (
        <div className="modal-body discard-panel">
          <h3>Discard this payment draft?</h3>
          <p className="muted">
            Your details have not been submitted. Keep editing to continue where
            you left off.
          </p>
          <div className="modal-actions">
            <button className="secondary danger" onClick={onClose}>
              Discard draft
            </button>
            <button
              className="primary"
              autoFocus
              onClick={() => setDiscard(false)}
            >
              Keep editing
            </button>
          </div>
        </div>
      ) : step === "details" ? (
        <form className="modal-body composer" onSubmit={review}>
          <p className="muted">
            Start with a recipient and amount. You’ll review everything before
            submitting.
          </p>
          <label>
            Beneficiary
            <select
              aria-label="Beneficiary"
              value={beneficiaryId}
              onChange={(e) => {
                changed();
                setBeneficiary(e.target.value);
              }}
            >
              {data.beneficiaries.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · •••• {b.account_suffix}
                </option>
              ))}
            </select>
          </label>
          <div className="recipient-summary">
            <span className="recipient-icon">
              <Wallet size={18} />
            </span>
            <span>
              <strong>{beneficiary.bank}</strong>
              <small>
                Account ending {beneficiary.account_suffix} ·{" "}
                {beneficiary.category}
              </small>
            </span>
          </div>
          <label>
            Amount (NGN)
            <div className="amount-input">
              <span aria-hidden="true">₦</span>
              <input
                autoFocus
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Amount (NGN)"
                aria-describedby="amount-help"
                value={amount}
                onChange={(e) => {
                  changed();
                  setAmount(e.target.value);
                }}
                required
              />
            </div>
          </label>
          <p className="field-help" id="amount-help">
            Nigerian naira · minimum ₦0.01
          </p>
          <label>
            Payment reference
            <input
              placeholder="e.g. September delivery services"
              minLength={3}
              maxLength={120}
              value={reference}
              onChange={(e) => {
                changed();
                setReference(e.target.value);
              }}
              required
            />
          </label>
          <p className="field-help">
            Give the reviewer enough context to recognize this payment.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary">
              Review payment
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      ) : (
        <div className="modal-body">
          <div className="review-summary">
            <span className="recipient-icon">
              <ArrowUpRight />
            </span>
            <p>Payment request</p>
            <h3 ref={heading} tabIndex={-1}>
              {money(minor)}
            </h3>
            <p>
              to <strong>{beneficiary.name}</strong>
            </p>
          </div>
          <dl className="detail-grid">
            <dt>Bank account</dt>
            <dd>
              {beneficiary.bank} · •••• {beneficiary.account_suffix}
            </dd>
            <dt>Reference</dt>
            <dd>{reference.trim()}</dd>
            <dt>Requested by</dt>
            <dd>{data.user.name}</dd>
            <dt>Next step</dt>
            <dd>Independent approval</dd>
          </dl>
          <div className="info">
            <ShieldCheck size={19} />
            <span>
              Submitting creates a request. Another checker must approve it
              before processing. No real funds move in this demo.
            </span>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setStep("details")}
            >
              Edit details
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Submitting…" : "Submit for approval"}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
