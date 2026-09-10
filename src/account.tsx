import { useEffect, useState, type FormEvent } from "react";
import { api } from "./lib";
import type { User } from "./types";
export function Recovery() {
  const [mode, setMode] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      await api(
        mode === "request"
          ? "/recovery/request"
          : mode === "recover"
            ? "/recovery/complete"
            : "/invitations/accept",
        fields,
      );
      setMessage(
        mode === "request"
          ? "If your account exists, recovery instructions have been queued."
          : "Completed. You can now sign in.",
      );
      setMode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-recovery">
      <div className="modal-actions">
        <button className="text-button" onClick={() => setMode("request")}>
          Forgot password?
        </button>
        <button className="text-button" onClick={() => setMode("recover")}>
          Use recovery token
        </button>
        <button className="text-button" onClick={() => setMode("invite")}>
          Accept invitation
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {mode && (
        <form onSubmit={submit}>
          {mode === "request" ? (
            <label>
              Recovery email
              <input name="email" type="email" required />
            </label>
          ) : (
            <>
              <label>
                {mode === "invite" ? "Invitation" : "Recovery"} token
                <input name="token" required minLength={64} maxLength={64} />
              </label>
              {mode === "invite" && (
                <label>
                  Your name
                  <input name="name" required minLength={2} maxLength={100} />
                </label>
              )}
              <label>
                {mode === "invite" ? "Account password" : "New password"}
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                />
              </label>
              {mode === "invite" && (
                <p className="muted">
                  Already have an account? Use its current password.
                </p>
              )}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="secondary" disabled={busy}>
            {busy ? "Working…" : "Continue"}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setMode("")}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
type Member = {
  id: string;
  name: string;
  email: string;
  role: User["role"];
  active: boolean;
};
export function Account({
  user,
  onChanged,
}: {
  user: User;
  onChanged: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (user.role === "admin")
      void api<Member[]>("/members")
        .then((m) => {
          if (active) setMembers(m);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [user.org_id, user.role]);
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(success);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="health-grid">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="panel health-card">
        <h2>Change password</h2>
        <p>Changing your password signs out all your sessions.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fields = Object.fromEntries(new FormData(e.currentTarget));
            void run(
              () => api("/password", fields),
              "Password changed. Sign in again.",
            );
          }}
        >
          <label>
            Current password
            <input
              name="current"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              name="next"
              type="password"
              required
              minLength={12}
              maxLength={200}
              autoComplete="new-password"
            />
          </label>
          <button className="primary" disabled={busy}>
            Change password
          </button>
        </form>
      </section>
      {user.role === "admin" && (
        <>
          <section className="panel health-card">
            <h2>Invite a member</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fields = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                void run(
                  () => api("/invitations", fields),
                  "Invitation queued for delivery.",
                );
              }}
            >
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Role
                <select name="role">
                  <option>viewer</option>
                  <option>maker</option>
                  <option>checker</option>
                  <option>admin</option>
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Send invitation
              </button>
            </form>
          </section>
          <section className="panel health-card">
            <h2>Workspace members</h2>
            {members.map((m) => (
              <form
                key={m.id}
                className="member-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fields = new FormData(e.currentTarget);
                  void run(async () => {
                    await api("/members/" + m.id, {
                      role: fields.get("role"),
                      active: fields.get("active") === "on",
                    });
                    setMembers(await api<Member[]>("/members"));
                  }, "Membership updated.");
                }}
              >
                <strong>{m.name}</strong>
                <p>{m.email}</p>
                <label>
                  Role for {m.name}
                  <select name="role" defaultValue={m.role}>
                    <option>viewer</option>
                    <option>maker</option>
                    <option>checker</option>
                    <option>admin</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={m.active}
                  />{" "}
                  Active membership
                </label>
                <button className="secondary" disabled={busy}>
                  Save {m.name}
                </button>
              </form>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
