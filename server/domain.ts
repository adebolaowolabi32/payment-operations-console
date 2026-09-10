import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, one, type Queryable } from "./db.js";
import { hash, passwordHash, passwordMatches, encrypt } from "./security.js";
import { captureContext, requestId, span } from "./telemetry.js";
export type Role = "maker" | "checker" | "admin" | "viewer";
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string;
  org_name?: string;
};
export type Payment = {
  id: string;
  org_id: string;
  beneficiary_id: string;
  amount: number;
  reference: string;
  status: string;
  created_by: string;
  reviewed_by: string | null;
  reason: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  trace_context: Record<string, string>;
};
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const demoUsers = [
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
] as const;
export const roles = z.enum(["maker", "checker", "admin", "viewer"]);
export const states = [
  "pending",
  "queued",
  "retrying",
  "reconciling",
  "paid",
  "declined",
  "failed",
  "rejected",
] as const;
const paymentInput = z
  .object({
    beneficiaryId: z.string().min(1),
    amount: z.string().regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/),
    reference: z.string().trim().min(3).max(120),
  })
  .strict();
const strongPassword = z.string().min(12).max(200);
export const detailSelect = `SELECT p.*,b.name beneficiary_name,b.bank,b.account_suffix,u.name creator_name,r.name reviewer_name,j.attempts_cycle attempts,j.next_at,j.last_error FROM payments p JOIN beneficiaries b ON b.org_id=p.org_id AND b.id=p.beneficiary_id JOIN users u ON u.id=p.created_by LEFT JOIN users r ON r.id=p.reviewed_by LEFT JOIN jobs j ON j.payment_id=p.id`;
export class Store {
  constructor(
    public db: Database,
    public now: () => number = Date.now,
  ) {}
  async audit(
    q: Queryable,
    org: string,
    actor: string,
    action: string,
    detail: string,
    payment: string | null = null,
  ) {
    await q.query(
      "INSERT INTO audit(org_id,payment_id,actor,action,detail,request_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [org, payment, actor, action, detail, requestId(), this.now()],
    );
  }
  async seed(password: string, examples = true) {
    const records = await Promise.all(
      demoUsers.map(async (u) => ({ ...u, ...(await passwordHash(password)) })),
    );
    await this.db.tx(async (q) => {
      await q.query(
        "SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':seed'))",
      );
      if (await one(q, "SELECT id FROM organizations LIMIT 1")) return;
      await q.query(
        "INSERT INTO organizations VALUES('org_cedar','Cedar Finance','healthy'),('org_harbor','Harbor Labs','healthy')",
      );
      for (const u of records) {
        await q.query(
          "INSERT INTO users(id,name,email,password_hash,salt) VALUES($1,$2,$3,$4,$5)",
          [u.id, u.name, u.email, u.password_hash, u.salt],
        );
        await q.query("INSERT INTO memberships VALUES($1,$2,$3,true)", [
          "org_cedar",
          u.id,
          u.role,
        ]);
      }
      await q.query(
        "INSERT INTO memberships VALUES('org_harbor','usr_amara','admin',true)",
      );
      for (const org of ["org_cedar", "org_harbor"]) {
        for (const b of [
          [
            "ben_atlas",
            "Atlas Logistics",
            "Demo Commercial Bank",
            "4821",
            "Logistics",
          ],
          [
            "ben_north",
            "Northstar Studio",
            "Demo Trust Bank",
            "9014",
            "Creative services",
          ],
          [
            "ben_cloud",
            "Cloudline Systems",
            "Demo Commercial Bank",
            "2039",
            "Software",
          ],
          [
            "ben_oak",
            "Oak & Bloom",
            "Demo Trust Bank",
            "7712",
            "Office supplies",
          ],
        ])
          await q.query("INSERT INTO beneficiaries VALUES($1,$2,$3,$4,$5,$6)", [
            b[0],
            org,
            ...b.slice(1),
          ]);
        await this.audit(
          q,
          org,
          "system",
          "workspace.created",
          "Synthetic workspace initialized.",
        );
      }
      if (examples) {
        for (const [i, b] of [
          "ben_atlas",
          "ben_north",
          "ben_cloud",
          "ben_oak",
        ].entries()) {
          const id = "pay_" + randomUUID();
          await q.query(
            "INSERT INTO payments(id,org_id,beneficiary_id,amount,reference,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
            [
              id,
              "org_cedar",
              b,
              [24500000, 18000000, 8950000, 3275000][i],
              [
                "September delivery services",
                "Brand design — milestone 2",
                "Cloud hosting subscription",
                "Office supplies replenishment",
              ][i],
              "pending",
              "usr_maya",
              this.now() + i,
            ],
          );
          await this.audit(
            q,
            "org_cedar",
            "usr_maya",
            "payment.created",
            "Submitted for independent approval.",
            id,
          );
          if (i === 3) {
            await q.query(
              "UPDATE payments SET status='rejected',reviewed_by='usr_daniel',reason='Correct the invoice reference',version=2 WHERE id=$1",
              [id],
            );
            await this.audit(
              q,
              "org_cedar",
              "usr_daniel",
              "payment.rejected",
              "Correct the invoice reference",
              id,
            );
          }
        }
      }
    });
  }
  async authorize(
    q: Queryable,
    u: User,
    allowed: Role[] = ["maker", "checker", "admin", "viewer"],
  ) {
    const row = await one(
      q,
      "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 AND active=true FOR SHARE",
      [u.org_id, u.id],
    );
    if (!row || !allowed.includes(row.role))
      throw new AppError(403, "Your membership does not permit this action.");
    return row.role as Role;
  }
  async throttle(key: string, limit = 20) {
    const row = await one(
      this.db.pool,
      `INSERT INTO throttle VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN throttle.expires_at<$3 THEN 1 ELSE throttle.count+1 END,expires_at=CASE WHEN throttle.expires_at<$3 THEN $2 ELSE throttle.expires_at END RETURNING count`,
      [hash(key), this.now() + 60000, this.now()],
    );
    if (row.count > limit)
      throw new AppError(429, "Too many attempts. Try again in a minute.");
    await this.db.pool.query(
      "DELETE FROM throttle WHERE key IN (SELECT key FROM throttle WHERE expires_at<$1 LIMIT 100)",
      [this.now()],
    );
  }
  async login(email: string, password: string) {
    const record = await one(
      this.db.pool,
      "SELECT * FROM users WHERE email=$1",
      [email.toLowerCase()],
    );
    if (!(await passwordMatches(password, record)))
      throw new AppError(401, "Email or password is incorrect.");
    return this.db.tx(async (q) => {
      const latest = await one(q, "SELECT * FROM users WHERE id=$1 FOR SHARE", [
        record.id,
      ]);
      if (latest.credential_version !== record.credential_version)
        throw new AppError(401, "Credentials changed. Sign in again.");
      const membership = await one(
        q,
        "SELECT * FROM memberships WHERE user_id=$1 AND active=true ORDER BY org_id LIMIT 1",
        [record.id],
      );
      if (!membership)
        throw new AppError(403, "No active workspace membership.");
      const token = randomBytes(32).toString("hex");
      await q.query("INSERT INTO sessions VALUES($1,$2,$3,$4,$5)", [
        hash(token),
        record.id,
        membership.org_id,
        record.credential_version,
        this.now() + 8 * 3600000,
      ]);
      await this.audit(
        q,
        membership.org_id,
        record.id,
        "session.started",
        "Signed in.",
      );
      return {
        token,
        user: {
          id: record.id,
          name: record.name,
          email: record.email,
          role: membership.role,
          org_id: membership.org_id,
        },
      };
    });
  }
  async user(token: string): Promise<User | undefined> {
    return one(
      this.db.pool,
      `SELECT u.id,u.name,u.email,m.role,s.org_id,o.name org_name FROM sessions s JOIN users u ON u.id=s.user_id AND u.credential_version=s.credential_version JOIN memberships m ON m.user_id=u.id AND m.org_id=s.org_id AND m.active=true JOIN organizations o ON o.id=s.org_id WHERE s.token=$1 AND s.expires_at>$2`,
      [hash(token), this.now()],
    );
  }
  async logout(token: string) {
    await this.db.pool.query("DELETE FROM sessions WHERE token=$1", [
      hash(token),
    ]);
  }
  async switchOrg(user: User, token: string, org: string) {
    return this.db.tx(async (q) => {
      await this.authorize(q, { ...user, org_id: org });
      await q.query(
        "UPDATE sessions SET org_id=$1 WHERE token=$2 AND user_id=$3",
        [org, hash(token), user.id],
      );
    });
  }
  async bootstrap(u: User) {
    await this.authorize(this.db.pool, u);
    return {
      user: u,
      memberships: await this.db.query(
        "SELECT o.id,o.name,m.role FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 AND m.active=true ORDER BY o.id",
        [u.id],
      ),
      providerMode: (
        await one(
          this.db.pool,
          "SELECT provider_mode FROM organizations WHERE id=$1",
          [u.org_id],
        )
      ).provider_mode,
    };
  }
  async payment(
    u: User,
    id: string,
    q: Queryable = this.db.pool,
    lock = false,
  ): Promise<Payment> {
    await this.authorize(q, u);
    const row = await one<Payment>(
      q,
      lock
        ? "SELECT * FROM payments WHERE org_id=$1 AND id=$2 FOR UPDATE"
        : detailSelect + " WHERE p.org_id=$1 AND p.id=$2",
      [u.org_id, id],
    );
    if (!row) throw new AppError(404, "Payment not found.");
    return row;
  }
  async create(u: User, raw: unknown, key: string) {
    const input = paymentInput.parse(raw);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key))
      throw new AppError(400, "A valid Idempotency-Key is required.");
    const [whole, part = ""] = input.amount.split(".");
    const amount = Number(whole) * 100 + Number(part.padEnd(2, "0"));
    if (amount < 1) throw new AppError(400, "Amount must be positive.");
    const fingerprint = hash(
      JSON.stringify({
        beneficiaryId: input.beneficiaryId,
        amount,
        reference: input.reference,
      }),
    );
    return span("payment.create", { org: u.org_id }, () =>
      this.db.tx(async (q) => {
        await this.authorize(q, u, ["maker", "admin"]);
        await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          u.org_id + u.id + key,
        ]);
        const prior = await one(
          q,
          "SELECT * FROM idempotency WHERE org_id=$1 AND actor=$2 AND key=$3",
          [u.org_id, u.id, key],
        );
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new AppError(
              409,
              "Request key already used with different details.",
            );
          return this.payment(u, prior.payment_id, q);
        }
        if (
          !(await one(
            q,
            "SELECT id FROM beneficiaries WHERE org_id=$1 AND id=$2",
            [u.org_id, input.beneficiaryId],
          ))
        )
          throw new AppError(400, "Choose a beneficiary in your workspace.");
        const id = "pay_" + randomUUID();
        await q.query(
          "INSERT INTO payments(id,org_id,beneficiary_id,amount,reference,status,created_by,created_at,updated_at,trace_context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)",
          [
            id,
            u.org_id,
            input.beneficiaryId,
            amount,
            input.reference,
            "pending",
            u.id,
            this.now(),
            captureContext(),
          ],
        );
        await q.query("INSERT INTO idempotency VALUES($1,$2,$3,$4,$5)", [
          u.org_id,
          u.id,
          key,
          fingerprint,
          id,
        ]);
        await this.audit(
          q,
          u.org_id,
          u.id,
          "payment.created",
          "Submitted for independent approval.",
          id,
        );
        return this.payment(u, id, q);
      }),
    );
  }
  async review(
    u: User,
    id: string,
    action: "approve" | "reject",
    version: number,
    reason?: string,
  ) {
    return span("payment.review", { payment: id, org: u.org_id }, () =>
      this.db.tx(async (q) => {
        await this.authorize(q, u, ["checker", "admin"]);
        const p = await this.payment(u, id, q, true);
        if (p.created_by === u.id)
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
            "Give a reason between 5 and 300 characters.",
          );
        await q.query(
          "UPDATE payments SET status=$1,reviewed_by=$2,reason=$3,version=version+1,updated_at=$4,trace_context=$6 WHERE id=$5",
          [
            action === "approve" ? "queued" : "rejected",
            u.id,
            action === "reject" ? reason!.trim() : null,
            this.now(),
            id,
            captureContext(),
          ],
        );
        if (action === "approve")
          await q.query(
            "INSERT INTO jobs(payment_id,org_id,next_at) VALUES($1,$2,$3)",
            [id, u.org_id, this.now()],
          );
        await this.audit(
          q,
          u.org_id,
          u.id,
          "payment." + (action === "approve" ? "approved" : "rejected"),
          action === "approve" ? "Approved and queued." : reason!.trim(),
          id,
        );
        return this.payment(u, id, q);
      }),
    );
  }
  async retry(u: User, id: string) {
    return this.db.tx(async (q) => {
      await this.authorize(q, u, ["checker", "admin"]);
      const p = await this.payment(u, id, q, true);
      if (p.status !== "failed")
        throw new AppError(
          409,
          "Only exhausted, unambiguous failures can be retried.",
        );
      await q.query(
        "UPDATE jobs SET done=false,attempts_cycle=0,next_at=$1,last_error=NULL,lease_owner=NULL,lease_until=NULL,claim_version=claim_version+1 WHERE payment_id=$2",
        [this.now(), id],
      );
      await q.query(
        "UPDATE payments SET status='queued',version=version+1,updated_at=$1 WHERE id=$2",
        [this.now(), id],
      );
      await this.audit(
        q,
        u.org_id,
        u.id,
        "payment.requeued",
        "New retry cycle requested; prior attempts retained.",
        id,
      );
      return this.payment(u, id, q);
    });
  }
  async setMode(u: User, mode: string) {
    if (
      ![
        "healthy",
        "offline",
        "timeout_once",
        "lookup_offline",
        "decline",
      ].includes(mode)
    )
      throw new AppError(400, "Unknown simulator mode.");
    await this.db.tx(async (q) => {
      await this.authorize(q, u, ["admin"]);
      await q.query("UPDATE organizations SET provider_mode=$1 WHERE id=$2", [
        mode,
        u.org_id,
      ]);
      await this.audit(
        q,
        u.org_id,
        u.id,
        "provider.mode_changed",
        "Simulator mode: " + mode,
      );
    });
  }
  async summary(u: User) {
    await this.authorize(this.db.pool, u);
    const rows = await this.db.query(
      "SELECT status,count(*)::int count,COALESCE(sum(amount),0)::bigint amount FROM payments WHERE org_id=$1 GROUP BY status",
      [u.org_id],
    );
    return {
      total: rows.reduce((n, r) => n + r.count, 0),
      amount: rows.reduce((n, r) => n + r.amount, 0),
      byStatus: Object.fromEntries(
        rows.map((r) => [r.status, { count: r.count, amount: r.amount }]),
      ),
    };
  }
  async list(u: User, query: unknown) {
    await this.authorize(this.db.pool, u);
    const options = z
      .object({
        status: z.enum(["all", ...states]).default("all"),
        search: z.string().max(120).default(""),
        sort: z.enum(["newest", "oldest", "amount"]).default("newest"),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().max(2048).optional(),
      })
      .parse(query);
    const scope = hash(
      JSON.stringify([u.org_id, options.status, options.search, options.sort]),
    );
    const args: any[] = [u.org_id];
    let where = "p.org_id=$1";
    if (options.status !== "all") {
      args.push(options.status);
      where += ` AND p.status=$${args.length}`;
    }
    if (options.search) {
      args.push("%" + options.search.replace(/[\\%_]/g, "\\$&") + "%");
      where += ` AND (b.name ILIKE $${args.length} OR p.reference ILIKE $${args.length} OR p.id ILIKE $${args.length})`;
    }
    const col = options.sort === "amount" ? "p.amount" : "p.created_at",
      direction = options.sort === "oldest" ? "ASC" : "DESC";
    if (options.cursor) {
      const cursor = this.cursor(options.cursor, scope);
      args.push(cursor.value, cursor.id);
      where += ` AND (${col},p.id) ${direction === "ASC" ? ">" : "<"} ($${args.length - 1},$${args.length})`;
    }
    args.push(options.limit + 1);
    const rows = await this.db.query(
      detailSelect +
        ` WHERE ${where} ORDER BY ${col} ${direction},p.id ${direction} LIMIT $${args.length}`,
      args,
    );
    const more = rows.length > options.limit;
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: more
        ? this.encode({
            scope,
            value: last[options.sort === "amount" ? "amount" : "created_at"],
            id: last.id,
          })
        : null,
    };
  }
  encode(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }
  cursor(encoded: string, scope: string) {
    try {
      const c = z
        .object({
          scope: z.literal(scope),
          value: z.number().int().nonnegative().safe(),
          id: z.string().max(100),
        })
        .parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
      return c;
    } catch {
      throw new AppError(400, "Invalid cursor for this query.");
    }
  }
  async history(u: User, query: unknown, paymentId?: string, attempts = false) {
    await this.authorize(this.db.pool, u);
    if (paymentId) await this.payment(u, paymentId);
    const { limit, cursor } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        cursor: z.string().max(2048).optional(),
      })
      .parse(query);
    const scope = hash(
      [u.org_id, paymentId ?? "", attempts ? "attempts" : "audit"].join(":"),
    );
    const args: any[] = [u.org_id];
    let where = "a.org_id=$1";
    if (paymentId) {
      args.push(paymentId);
      where += " AND a.payment_id=$2";
    }
    if (cursor) {
      args.push(this.cursor(cursor, scope).value);
      where += ` AND a.id<$${args.length}`;
    }
    args.push(limit + 1);
    const rows = await this.db.query(
      attempts
        ? `SELECT a.* FROM attempts a WHERE ${where} ORDER BY a.id DESC LIMIT $${args.length}`
        : `SELECT a.*,COALESCE(u.name,'System') actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor WHERE ${where} ORDER BY a.id DESC LIMIT $${args.length}`,
      args,
    );
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor:
        rows.length > limit
          ? this.encode({ scope, value: items.at(-1).id, id: "" })
          : null,
    };
  }
  async beneficiaries(u: User, query: unknown) {
    await this.authorize(this.db.pool, u);
    const { limit, cursor } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().max(2048).optional(),
      })
      .parse(query);
    const scope = hash(u.org_id + ":beneficiaries");
    const after = cursor ? this.cursor(cursor, scope).id : "";
    const rows = await this.db.query(
      "SELECT * FROM beneficiaries WHERE org_id=$1 AND id>$2 ORDER BY id LIMIT $3",
      [u.org_id, after, limit + 1],
    );
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor:
        rows.length > limit
          ? this.encode({ scope, value: 0, id: items.at(-1).id })
          : null,
    };
  }
  async members(u: User) {
    await this.authorize(this.db.pool, u, ["admin"]);
    return this.db.query(
      "SELECT u.id,u.name,u.email,m.role,m.active FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY u.id LIMIT 100",
      [u.org_id],
    );
  }
  async memberRole(u: User, id: string, role: Role, active: boolean) {
    await this.db.tx(async (q) => {
      await one(q, "SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        u.org_id,
      ]);
      await this.authorize(q, u, ["admin"]);
      if (
        !(await one(
          q,
          "SELECT * FROM memberships WHERE org_id=$1 AND user_id=$2",
          [u.org_id, id],
        ))
      )
        throw new AppError(404, "Member not found.");
      await q.query(
        "UPDATE memberships SET role=$1,active=$2 WHERE org_id=$3 AND user_id=$4",
        [role, active, u.org_id, id],
      );
      if (
        !(await one(
          q,
          "SELECT user_id FROM memberships WHERE org_id=$1 AND role='admin' AND active=true",
          [u.org_id],
        ))
      )
        throw new AppError(409, "Keep at least one active administrator.");
      await this.audit(
        q,
        u.org_id,
        u.id,
        "member.updated",
        `Membership ${id}: ${role}, active=${active}`,
      );
    });
  }
  async invite(u: User, email: string, role: Role) {
    const token = randomBytes(32).toString("hex");
    await this.db.tx(async (q) => {
      await this.authorize(q, u, ["admin"]);
      await q.query("INSERT INTO invitations VALUES($1,$2,$3,$4,$5,NULL)", [
        hash(token),
        u.org_id,
        email.toLowerCase(),
        role,
        this.now() + 24 * 3600000,
      ]);
      await q.query(
        "INSERT INTO delivery_outbox(recipient,kind,payload,created_at) VALUES($1,$2,$3,$4)",
        [
          email.toLowerCase(),
          "invitation",
          encrypt(JSON.stringify({ token, org: u.org_name ?? u.org_id })),
          this.now(),
        ],
      );
      await this.audit(
        q,
        u.org_id,
        u.id,
        "member.invited",
        "Invitation queued for delivery.",
      );
    });
    return { ok: true };
  }
  async acceptInvitation(raw: unknown) {
    const input = z
      .object({
        token: z.string().length(64),
        name: z.string().trim().min(2).max(100),
        password: strongPassword,
      })
      .parse(raw);
    const candidate = await one(
      this.db.pool,
      "SELECT * FROM invitations WHERE token=$1 AND used_at IS NULL AND expires_at>$2",
      [hash(input.token), this.now()],
    );
    if (!candidate)
      throw new AppError(400, "Invitation is invalid or expired.");
    const existing = await one(
      this.db.pool,
      "SELECT * FROM users WHERE email=$1",
      [candidate.email],
    );
    if (existing && !(await passwordMatches(input.password, existing)))
      throw new AppError(
        401,
        "Use the existing account password to accept this invitation.",
      );
    const creds = existing ?? (await passwordHash(input.password));
    await this.db.tx(async (q) => {
      await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        candidate.email,
      ]);
      const invite = await one(
        q,
        "SELECT * FROM invitations WHERE token=$1 AND used_at IS NULL AND expires_at>$2 FOR UPDATE",
        [hash(input.token), this.now()],
      );
      if (!invite) throw new AppError(400, "Invitation is invalid or expired.");
      const latest = await one(
        q,
        "SELECT * FROM users WHERE email=$1 FOR UPDATE",
        [candidate.email],
      );
      if (
        (latest && !existing) ||
        (existing && latest.credential_version !== existing.credential_version)
      )
        throw new AppError(409, "Account changed. Try accepting again.");
      const id = existing?.id ?? "usr_" + randomUUID();
      if (!existing)
        await q.query(
          "INSERT INTO users(id,name,email,password_hash,salt) VALUES($1,$2,$3,$4,$5)",
          [id, input.name, candidate.email, creds.password_hash, creds.salt],
        );
      await q.query(
        "INSERT INTO memberships VALUES($1,$2,$3,true) ON CONFLICT(org_id,user_id) DO NOTHING",
        [invite.org_id, id, invite.role],
      );
      await q.query("UPDATE invitations SET used_at=$1 WHERE token=$2", [
        this.now(),
        hash(input.token),
      ]);
      await this.audit(
        q,
        invite.org_id,
        id,
        "invitation.accepted",
        "Membership activated.",
      );
    });
  }
  async rotatePassword(u: User, current: string, next: string) {
    strongPassword.parse(next);
    const record = await one(this.db.pool, "SELECT * FROM users WHERE id=$1", [
      u.id,
    ]);
    if (!(await passwordMatches(current, record)))
      throw new AppError(401, "Current password is incorrect.");
    const creds = await passwordHash(next);
    await this.db.tx(async (q) => {
      await this.authorize(q, u);
      const row = await one(
        q,
        "UPDATE users SET password_hash=$1,salt=$2,credential_version=credential_version+1 WHERE id=$3 AND credential_version=$4 RETURNING id",
        [creds.password_hash, creds.salt, u.id, record.credential_version],
      );
      if (!row) throw new AppError(409, "Credentials changed. Try again.");
      await q.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await q.query(
        "UPDATE recoveries SET used_at=$1 WHERE user_id=$2 AND used_at IS NULL",
        [this.now(), u.id],
      );
      await this.audit(
        q,
        u.org_id,
        u.id,
        "credentials.rotated",
        "Password changed; all sessions revoked.",
      );
    });
  }
  async requestRecovery(email: string) {
    const row = await one(this.db.pool, "SELECT id FROM users WHERE email=$1", [
      email.toLowerCase(),
    ]);
    if (row) {
      const token = randomBytes(32).toString("hex");
      await this.db.tx(async (q) => {
        await q.query("INSERT INTO recoveries VALUES($1,$2,$3,NULL)", [
          hash(token),
          row.id,
          this.now() + 30 * 60000,
        ]);
        await q.query(
          "INSERT INTO delivery_outbox(recipient,kind,payload,created_at) VALUES($1,$2,$3,$4)",
          [
            email.toLowerCase(),
            "recovery",
            encrypt(JSON.stringify({ token })),
            this.now(),
          ],
        );
      });
    }
    return {
      ok: true,
      message:
        "If this account exists, recovery instructions have been queued.",
    };
  }
  async recover(token: string, password: string) {
    strongPassword.parse(password);
    const creds = await passwordHash(password);
    await this.db.tx(async (q) => {
      const candidate = await one(
        q,
        "SELECT user_id FROM recoveries WHERE token=$1",
        [hash(token)],
      );
      if (!candidate)
        throw new AppError(400, "Recovery token is invalid or expired.");
      // Serialize credential changes before locking one-time tokens, including
      // two distinct recovery tokens for the same account.
      await one(q, "SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        candidate.user_id,
      ]);
      const record = await one(
        q,
        "SELECT * FROM recoveries WHERE token=$1 AND used_at IS NULL AND expires_at>$2 FOR UPDATE",
        [hash(token), this.now()],
      );
      if (!record)
        throw new AppError(400, "Recovery token is invalid or expired.");
      await q.query(
        "UPDATE users SET password_hash=$1,salt=$2,credential_version=credential_version+1 WHERE id=$3",
        [creds.password_hash, creds.salt, record.user_id],
      );
      await q.query("DELETE FROM sessions WHERE user_id=$1", [record.user_id]);
      await q.query(
        "UPDATE recoveries SET used_at=$1 WHERE user_id=$2 AND used_at IS NULL",
        [this.now(), record.user_id],
      );
      for (const m of (
        await q.query("SELECT org_id FROM memberships WHERE user_id=$1", [
          record.user_id,
        ])
      ).rows)
        await this.audit(
          q,
          m.org_id,
          record.user_id,
          "credentials.recovered",
          "Credentials recovered; all sessions revoked.",
        );
    });
  }
  async callback(event: {
    id: string;
    paymentId: string;
    amount: number;
    receipt: string;
    outcome: "confirmed" | "declined";
  }) {
    await this.db.tx(async (q) => {
      const p = await one<Payment>(
        q,
        "SELECT * FROM payments WHERE id=$1 FOR UPDATE",
        [event.paymentId],
      );
      if (!p || p.amount !== event.amount)
        throw new AppError(400, "Callback payment mismatch.");
      const inserted = await one(
        q,
        "INSERT INTO callback_events VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [event.id, this.now()],
      );
      if (!inserted) return;
      if (!["queued", "retrying", "reconciling", "failed"].includes(p.status))
        return;
      const status = event.outcome === "confirmed" ? "paid" : "declined";
      await q.query(
        "UPDATE payments SET status=$1,receipt=$2,version=version+1,updated_at=$3 WHERE id=$4",
        [
          status,
          event.outcome === "confirmed" ? event.receipt : null,
          this.now(),
          p.id,
        ],
      );
      await q.query(
        "UPDATE jobs SET done=true,lease_owner=NULL,lease_until=NULL,claim_version=claim_version+1 WHERE payment_id=$1",
        [p.id],
      );
      await this.audit(
        q,
        p.org_id,
        "provider",
        "payment." + status,
        "Signed provider callback confirmed the outcome.",
        p.id,
      );
    });
  }
  async health() {
    await this.db.query("SELECT 1");
    const row = (
      await this.db.query(
        `SELECT count(*) FILTER(WHERE done=false)::int queued,count(*) FILTER(WHERE uncertain AND done=false)::int reconciling,COALESCE(max($1-next_at) FILTER(WHERE done=false AND next_at<$1),0)::bigint queue_age_ms FROM jobs`,
        [this.now()],
      )
    )[0];
    const heartbeat = (
      await this.db.query(
        "SELECT max(seen_at) last_worker FROM worker_heartbeats",
      )
    )[0];
    return { ...row, ...heartbeat };
  }
}
