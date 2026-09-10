import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

export type Role = "maker" | "checker" | "admin" | "viewer";
export type User = { id: string; name: string; email: string; role: Role };
export type Payment = {
  id: string;
  beneficiary_id: string;
  amount: number;
  reference: string;
  status: "pending" | "queued" | "retrying" | "paid" | "failed" | "rejected";
  created_by: string;
  reviewed_by: string | null;
  reason: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const demoUsers: User[] = [
  {
    id: "usr_maya",
    name: "Maya Johnson",
    email: "maya@ledgerdesk.demo",
    role: "maker",
  },
  {
    id: "usr_daniel",
    name: "Daniel Okafor",
    email: "daniel@ledgerdesk.demo",
    role: "checker",
  },
  {
    id: "usr_amara",
    name: "Amara Bello",
    email: "amara@ledgerdesk.demo",
    role: "admin",
  },
  {
    id: "usr_alex",
    name: "Alex Morgan",
    email: "alex@ledgerdesk.demo",
    role: "viewer",
  },
];
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const inputSchema = z
  .object({
    beneficiaryId: z.string().min(1),
    amount: z
      .string()
      .regex(
        /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/,
        "Use a positive amount with at most two decimal places.",
      ),
    reference: z.string().trim().min(3).max(120),
  })
  .strict();
export class Store {
  db: DatabaseSync;
  constructor(
    path: string,
    public now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK(role IN ('maker','checker','admin','viewer')), password_hash TEXT NOT NULL, salt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS beneficiaries(id TEXT PRIMARY KEY,name TEXT NOT NULL,bank TEXT NOT NULL,account_suffix TEXT NOT NULL,category TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, beneficiary_id TEXT NOT NULL REFERENCES beneficiaries(id), amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 9999999999), reference TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','queued','retrying','paid','failed','rejected')),created_by TEXT NOT NULL REFERENCES users(id),reviewed_by TEXT REFERENCES users(id),reason TEXT,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,CHECK(reviewed_by IS NULL OR reviewed_by != created_by));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,payment_id TEXT REFERENCES payments(id),actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
      CREATE TABLE IF NOT EXISTS idempotency(actor TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,payment_id TEXT NOT NULL REFERENCES payments(id),PRIMARY KEY(actor,key));
      CREATE TABLE IF NOT EXISTS jobs(payment_id TEXT PRIMARY KEY REFERENCES payments(id),attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,last_error TEXT);
      CREATE TABLE IF NOT EXISTS provider_receipts(payment_id TEXT PRIMARY KEY REFERENCES payments(id),receipt TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO settings VALUES('provider_mode','healthy');
      CREATE INDEX IF NOT EXISTS audit_payment ON audit(payment_id,id);
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(done,next_at);
    `);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(
    actor: string,
    action: string,
    detail: string,
    paymentId: string | null = null,
  ) {
    this.db
      .prepare(
        "INSERT INTO audit(payment_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",
      )
      .run(paymentId, actor, action, detail, this.now());
  }
  seed(password: string, examples = true) {
    if (this.db.prepare("SELECT id FROM users LIMIT 1").get()) return;
    this.transaction(() => {
      for (const u of demoUsers) {
        const salt = randomBytes(16).toString("hex");
        this.db
          .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
          .run(
            u.id,
            u.name,
            u.email,
            u.role,
            scryptSync(password, salt, 64).toString("hex"),
            salt,
          );
      }
      const stmt = this.db.prepare(
        "INSERT INTO beneficiaries VALUES(?,?,?,?,?)",
      );
      stmt.run(
        "ben_atlas",
        "Atlas Logistics",
        "Demo Commercial Bank",
        "4821",
        "Logistics",
      );
      stmt.run(
        "ben_north",
        "Northstar Studio",
        "Demo Trust Bank",
        "9014",
        "Creative services",
      );
      stmt.run(
        "ben_cloud",
        "Cloudline Systems",
        "Demo Commercial Bank",
        "2039",
        "Software",
      );
      stmt.run(
        "ben_oak",
        "Oak & Bloom",
        "Demo Trust Bank",
        "7712",
        "Office supplies",
      );
      this.audit(
        "system",
        "workspace.created",
        "Synthetic demo workspace initialized.",
      );
    });
    if (examples) {
      const maker = demoUsers[0],
        checker = demoUsers[1];
      const a = this.create(
        maker,
        {
          beneficiaryId: "ben_atlas",
          amount: "245000",
          reference: "September delivery services",
        },
        "seed-atlas-payment",
      );
      this.create(
        maker,
        {
          beneficiaryId: "ben_north",
          amount: "180000",
          reference: "Brand design — milestone 2",
        },
        "seed-north-payment",
      );
      const c = this.create(
        maker,
        {
          beneficiaryId: "ben_cloud",
          amount: "89500",
          reference: "Cloud hosting subscription",
        },
        "seed-cloud-payment",
      );
      this.review(checker, c.id, "approve", c.version);
      this.tick();
      const d = this.create(
        maker,
        {
          beneficiaryId: "ben_oak",
          amount: "32750",
          reference: "Office supplies replenishment",
        },
        "seed-oak-payment",
      );
      this.review(
        checker,
        d.id,
        "reject",
        d.version,
        "Please attach the correct purchase-order reference.",
      );
      // Keep two approval requests ready for the guided demo.
      void a;
    }
  }
  login(email: string, password: string) {
    const row = this.db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(email.toLowerCase()) as
      (User & { salt: string; password_hash: string }) | undefined;
    const actual = scryptSync(
      password,
      row?.salt ?? "nonexistent-user-salt",
      64,
    );
    if (!row || !timingSafeEqual(actual, Buffer.from(row.password_hash, "hex")))
      throw new AppError(401, "Email or password is incorrect.");
    const token = randomBytes(32).toString("hex");
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(this.now());
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(hash(token), row.id, this.now() + 8 * 60 * 60 * 1000);
    this.audit(row.id, "session.started", "Signed in.");
    return {
      token,
      user: { id: row.id, name: row.name, email: row.email, role: row.role },
    };
  }
  user(token: string): User | undefined {
    return this.db
      .prepare(
        "SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?",
      )
      .get(hash(token), this.now()) as User | undefined;
  }
  logout(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
  }
  allow(user: User, roles: Role[]) {
    if (!roles.includes(user.role))
      throw new AppError(403, "Your role cannot perform this action.");
  }
  payment(id: string): Payment {
    const p = this.db.prepare("SELECT * FROM payments WHERE id=?").get(id) as
      Payment | undefined;
    if (!p) throw new AppError(404, "Payment not found.");
    return p;
  }
  create(user: User, raw: unknown, key: string) {
    this.allow(user, ["maker", "admin"]);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key))
      throw new AppError(400, "A valid Idempotency-Key is required.");
    const input = inputSchema.parse(raw);
    const [whole, fraction = ""] = input.amount.split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (amount <= 0)
      throw new AppError(400, "Amount must be greater than zero.");
    const fingerprint = hash(
      JSON.stringify({
        beneficiaryId: input.beneficiaryId,
        amount,
        reference: input.reference,
      }),
    );
    return this.transaction(() => {
      const prev = this.db
        .prepare("SELECT * FROM idempotency WHERE actor=? AND key=?")
        .get(user.id, key) as
        { fingerprint: string; payment_id: string } | undefined;
      if (prev) {
        if (prev.fingerprint !== fingerprint)
          throw new AppError(
            409,
            "This request key was already used for different payment details.",
          );
        return this.payment(prev.payment_id);
      }
      if (
        !this.db
          .prepare("SELECT id FROM beneficiaries WHERE id=?")
          .get(input.beneficiaryId)
      )
        throw new AppError(400, "Choose an existing beneficiary.");
      const id = "pay_" + randomUUID(),
        now = this.now();
      this.db
        .prepare(
          "INSERT INTO payments(id,beneficiary_id,amount,reference,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.beneficiaryId,
          amount,
          input.reference,
          "pending",
          user.id,
          now,
          now,
        );
      this.db
        .prepare("INSERT INTO idempotency VALUES(?,?,?,?)")
        .run(user.id, key, fingerprint, id);
      this.audit(
        user.id,
        "payment.created",
        "Submitted for independent approval.",
        id,
      );
      return this.payment(id);
    });
  }
  review(
    user: User,
    id: string,
    action: "approve" | "reject",
    version: number,
    reason?: string,
  ) {
    this.allow(user, ["checker", "admin"]);
    return this.transaction(() => {
      const p = this.payment(id);
      if (p.created_by === user.id)
        throw new AppError(
          403,
          "You cannot review a payment you created. Ask another checker.",
        );
      if (p.status !== "pending" || p.version !== version)
        throw new AppError(
          409,
          "This payment has changed. Refresh before reviewing.",
        );
      if (
        action === "reject" &&
        (!reason || reason.trim().length < 5 || reason.length > 300)
      )
        throw new AppError(
          400,
          "Give a rejection reason between 5 and 300 characters.",
        );
      const state = action === "approve" ? "queued" : "rejected";
      this.db
        .prepare(
          "UPDATE payments SET status=?,reviewed_by=?,reason=?,version=version+1,updated_at=? WHERE id=?",
        )
        .run(
          state,
          user.id,
          action === "reject" ? reason!.trim() : null,
          this.now(),
          id,
        );
      if (action === "approve")
        this.db
          .prepare("INSERT INTO jobs(payment_id,next_at) VALUES(?,?)")
          .run(id, this.now());
      this.audit(
        user.id,
        action === "approve" ? "payment.approved" : "payment.rejected",
        action === "approve"
          ? "Approved and queued for processing."
          : reason!.trim(),
        id,
      );
      return this.payment(id);
    });
  }
  mode() {
    return (
      this.db
        .prepare("SELECT value FROM settings WHERE key='provider_mode'")
        .get() as { value: string }
    ).value;
  }
  setMode(user: User, mode: string) {
    this.allow(user, ["admin"]);
    if (!["healthy", "offline", "timeout_once"].includes(mode))
      throw new AppError(400, "Unknown simulator mode.");
    this.transaction(() => {
      this.db
        .prepare("UPDATE settings SET value=? WHERE key='provider_mode'")
        .run(mode);
      this.audit(user.id, "provider.mode_changed", "Simulator mode: " + mode);
    });
  }
  retry(user: User, id: string) {
    this.allow(user, ["admin", "checker"]);
    return this.transaction(() => {
      const p = this.payment(id);
      if (p.status !== "failed")
        throw new AppError(409, "Only exhausted payments can be retried.");
      this.db
        .prepare(
          "UPDATE jobs SET done=0,attempts=0,next_at=?,last_error=NULL WHERE payment_id=?",
        )
        .run(this.now(), id);
      this.db
        .prepare(
          "UPDATE payments SET status='queued',version=version+1,updated_at=? WHERE id=?",
        )
        .run(this.now(), id);
      this.audit(
        user.id,
        "payment.requeued",
        "A new bounded retry cycle was requested.",
        id,
      );
      return this.payment(id);
    });
  }
  tick() {
    // Single synchronous worker. Provider receipt persists before local confirmation,
    // reproducing the failure window of a provider accepting a payment then timing out.
    const jobs = this.db
      .prepare(
        "SELECT * FROM jobs WHERE done=0 AND next_at<=? ORDER BY next_at LIMIT 20",
      )
      .all(this.now()) as { payment_id: string; attempts: number }[];
    for (const job of jobs) {
      let failure: string | null = null;
      const receipt = this.db
        .prepare("SELECT receipt FROM provider_receipts WHERE payment_id=?")
        .get(job.payment_id);
      if (!receipt) {
        if (this.mode() === "offline")
          failure = "Simulated provider unavailable.";
        else {
          this.db
            .prepare("INSERT INTO provider_receipts VALUES(?,?,?)")
            .run(job.payment_id, "mock_" + randomUUID(), this.now());
          if (this.mode() === "timeout_once")
            failure =
              "Provider accepted the payment but its response timed out. Retry will reconcile the same payment key.";
        }
      }
      this.transaction(() => {
        const attempts = job.attempts + 1;
        const status = failure
          ? attempts >= 3
            ? "failed"
            : "retrying"
          : "paid";
        this.db
          .prepare(
            "UPDATE jobs SET attempts=?,next_at=?,done=?,last_error=? WHERE payment_id=?",
          )
          .run(
            attempts,
            this.now() + 5000 * 2 ** (attempts - 1),
            status === "paid" || status === "failed" ? 1 : 0,
            failure,
            job.payment_id,
          );
        this.db
          .prepare(
            "UPDATE payments SET status=?,updated_at=?,version=version+1 WHERE id=?",
          )
          .run(status, this.now(), job.payment_id);
        this.audit(
          "system",
          failure
            ? status === "failed"
              ? "payment.failed"
              : "payment.retry_scheduled"
            : "payment.paid",
          failure ?? "Provider receipt confirmed. No real funds moved.",
          job.payment_id,
        );
      });
    }
    return jobs.length;
  }
  snapshot(user: User) {
    return {
      user,
      users: this.db.prepare("SELECT id,name,email,role FROM users").all(),
      beneficiaries: this.db
        .prepare("SELECT * FROM beneficiaries ORDER BY name")
        .all(),
      payments: this.db
        .prepare(
          "SELECT p.*, b.name AS beneficiary_name,b.bank,b.account_suffix,u.name AS creator_name,r.name AS reviewer_name,j.attempts,j.next_at,j.last_error,pr.receipt FROM payments p JOIN beneficiaries b ON b.id=p.beneficiary_id JOIN users u ON u.id=p.created_by LEFT JOIN users r ON r.id=p.reviewed_by LEFT JOIN jobs j ON j.payment_id=p.id LEFT JOIN provider_receipts pr ON pr.payment_id=p.id ORDER BY p.created_at DESC,p.rowid DESC",
        )
        .all(),
      audit: this.db
        .prepare(
          "SELECT a.*,COALESCE(u.name,'System') AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.id DESC LIMIT 500",
        )
        .all(),
      providerMode: this.mode(),
      serverTime: this.now(),
    };
  }
}
