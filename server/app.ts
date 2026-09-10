import express from "express";
import { z, ZodError } from "zod";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { AppError, Store, roles, type User } from "./domain.js";
import { span, withRequest, log } from "./telemetry.js";
import { HttpProvider } from "./provider.js";
export function createApp(
  store: Store,
  options: { secureCookies?: boolean; demo?: boolean } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  const trust = process.env.TRUST_PROXY;
  if (trust)
    app.set(
      "trust proxy",
      trust.split(",").map((s) => s.trim()),
    );
  app.use((req, res, next) => {
    const id = randomUUID(),
      started = Date.now();
    res.set("X-Request-Id", id);
    withRequest(id, () => {
      void span(
        "http.request",
        { method: req.method, path: req.path },
        () =>
          new Promise<void>((resolve) => {
            res.once("finish", () => {
              log("http.response", {
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs: Date.now() - started,
              });
              resolve();
            });
            res.once("close", resolve);
            next();
          }),
        req.headers as Record<string, string>,
      ).catch(next);
    });
  });
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  // Verify a timestamped HMAC over the original bytes before JSON decoding.
  app.post(
    "/api/provider/callback",
    express.raw({ type: "application/json", limit: "16kb" }),
    async (req, res) => {
      const secret = process.env.WEBHOOK_SECRET;
      if (!secret) throw new AppError(503, "Callbacks are not configured.");
      const timestamp = req.get("X-Provider-Timestamp") ?? "",
        signature = req.get("X-Provider-Signature") ?? "";
      if (
        !/^\d{13}$/.test(timestamp) ||
        Math.abs(Date.now() - Number(timestamp)) > 300000 ||
        !Buffer.isBuffer(req.body) ||
        !/^[a-f0-9]{64}$/.test(signature)
      )
        throw new AppError(401, "Invalid callback signature.");
      const expected = createHmac("sha256", secret)
        .update(timestamp + ".")
        .update(req.body)
        .digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
        throw new AppError(401, "Invalid callback signature.");
      const event = z
        .object({
          id: z.string().min(1).max(100),
          paymentId: z.string().max(100),
          amount: z.number().int().positive(),
          receipt: z.string().max(200),
          outcome: z.enum(["confirmed", "declined"]),
        })
        .parse(JSON.parse(req.body.toString()));
      await store.callback(event);
      res.json({ ok: true });
    },
  );
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("X-Requested-With") !== "LedgerDesk" ||
        req.get("Sec-Fetch-Site") === "cross-site")
    )
      return next(new AppError(403, "Same-origin request header required."));
    next();
  });
  const token = (req: express.Request) =>
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("ledger_session="))
      ?.slice(15) ?? "";
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/ready", async (_req, res) => {
    try {
      const health = await store.health();
      const fresh =
        !health.queued ||
        (health.last_worker && store.now() - health.last_worker < 15000);
      const provider = await new HttpProvider().healthy();
      res.status(fresh && provider ? 200 : 503).json({
        status: fresh && provider ? "ready" : "degraded",
        database: true,
        worker: !!fresh,
        provider,
      });
    } catch {
      res.status(503).json({ status: "unavailable", database: false });
    }
  });
  app.post("/api/login", async (req, res) => {
    await store.throttle("login:" + (req.ip ?? "unknown"));
    const input = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const { token, user } = await store.login(input.email, input.password);
    res
      .cookie("ledger_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookies ?? process.env.NODE_ENV === "production",
        maxAge: 8 * 3600000,
        path: "/",
      })
      .json({ user });
  });
  app.post("/api/invitations/accept", async (req, res) => {
    await store.throttle("invite:" + (req.ip ?? ""));
    await store.acceptInvitation(req.body);
    res.json({ ok: true });
  });
  app.post("/api/recovery/request", async (req, res) => {
    await store.throttle("recovery:" + (req.ip ?? ""), 5);
    const body = z
      .object({ email: z.string().email().max(200) })
      .parse(req.body);
    res.json(await store.requestRecovery(body.email));
  });
  app.post("/api/recovery/complete", async (req, res) => {
    await store.throttle("recovery-complete:" + (req.ip ?? ""), 10);
    const body = z
      .object({
        token: z.string().length(64),
        password: z.string().min(12).max(200),
      })
      .parse(req.body);
    await store.recover(body.token, body.password);
    res.json({ ok: true });
  });
  app.use("/api", async (req, res, next) => {
    const user = await store.user(token(req));
    if (!user) throw new AppError(401, "Sign in to continue.");
    res.locals.user = user;
    next();
  });
  app.post("/api/logout", async (req, res) => {
    await store.logout(token(req));
    res.clearCookie("ledger_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/bootstrap", async (_req, res) =>
    res.json(await store.bootstrap(res.locals.user)),
  );
  app.post("/api/workspace/switch", async (req, res) => {
    const body = z.object({ orgId: z.string().max(100) }).parse(req.body);
    await store.switchOrg(res.locals.user, token(req), body.orgId);
    res.json({ ok: true });
  });
  app.get("/api/summary", async (_req, res) =>
    res.json(await store.summary(res.locals.user)),
  );
  app.get("/api/payments", async (req, res) =>
    res.json(await store.list(res.locals.user, req.query)),
  );
  app.get("/api/payments/:id", async (req, res) =>
    res.json(await store.payment(res.locals.user, String(req.params.id))),
  );
  app.get("/api/payments/:id/history", async (req, res) =>
    res.json(
      await store.history(res.locals.user, req.query, String(req.params.id)),
    ),
  );
  app.get("/api/payments/:id/attempts", async (req, res) =>
    res.json(
      await store.history(
        res.locals.user,
        req.query,
        String(req.params.id),
        true,
      ),
    ),
  );
  app.get("/api/audit", async (req, res) =>
    res.json(await store.history(res.locals.user, req.query)),
  );
  app.get("/api/beneficiaries", async (req, res) =>
    res.json(await store.beneficiaries(res.locals.user, req.query)),
  );
  app.post("/api/payments", async (req, res) =>
    res
      .status(201)
      .json(
        await store.create(
          res.locals.user,
          req.body,
          req.get("Idempotency-Key") ?? "",
        ),
      ),
  );
  app.post("/api/payments/:id/review", async (req, res) => {
    const body = z
      .object({
        action: z.enum(["approve", "reject"]),
        version: z.number().int().positive(),
        reason: z.string().max(300).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await store.review(
        res.locals.user,
        String(req.params.id),
        body.action,
        body.version,
        body.reason,
      ),
    );
  });
  app.post("/api/payments/:id/retry", async (req, res) =>
    res.json(await store.retry(res.locals.user, String(req.params.id))),
  );
  app.post("/api/provider", async (req, res) => {
    if (options.demo === false)
      throw new AppError(404, "Simulator controls disabled.");
    await store.setMode(
      res.locals.user,
      z.object({ mode: z.string() }).parse(req.body).mode,
    );
    res.json({ ok: true });
  });
  app.get("/api/members", async (_req, res) =>
    res.json(await store.members(res.locals.user)),
  );
  app.post("/api/members/:id", async (req, res) => {
    const body = z.object({ role: roles, active: z.boolean() }).parse(req.body);
    await store.memberRole(
      res.locals.user,
      String(req.params.id),
      body.role,
      body.active,
    );
    res.json({ ok: true });
  });
  app.post("/api/invitations", async (req, res) => {
    const body = z
      .object({ email: z.string().email().max(200), role: roles })
      .parse(req.body);
    res.json(await store.invite(res.locals.user, body.email, body.role));
  });
  app.post("/api/password", async (req, res) => {
    const body = z
      .object({
        current: z.string().max(200),
        next: z.string().min(12).max(200),
      })
      .parse(req.body);
    await store.rotatePassword(res.locals.user, body.current, body.next);
    res.clearCookie("ledger_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/operations", async (_req, res) => {
    const u = res.locals.user as User;
    await store.authorize(store.db.pool, u, ["admin"]);
    const queue = (
      await store.db.query(
        `SELECT count(*) FILTER(WHERE done=false)::int queued,count(*) FILTER(WHERE uncertain AND done=false)::int reconciling,COALESCE(max($2-next_at) FILTER(WHERE done=false AND next_at<$2),0)::bigint queue_age_ms FROM jobs WHERE org_id=$1`,
        [u.org_id, store.now()],
      )
    )[0];
    const attempts = await store.db.query(
      "SELECT outcome,count(*)::int count FROM attempts WHERE org_id=$1 GROUP BY outcome",
      [u.org_id],
    );
    const timing = (
      await store.db.query(
        "SELECT COALESCE(avg(updated_at-created_at),0)::float mean_confirmation_ms FROM payments WHERE org_id=$1 AND status='paid'",
        [u.org_id],
      )
    )[0];
    res.json({ ...queue, ...timing, attempts });
  });
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "API route not found.")),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError)
        return res
          .status(400)
          .json({ error: err.issues.map((i) => i.message).join(" ") });
      if (err instanceof AppError)
        return res.status(err.status).json({ error: err.message });
      if (err instanceof SyntaxError)
        return res.status(400).json({ error: "Invalid JSON body." });
      if (err.type === "entity.too.large")
        return res.status(413).json({ error: "Request too large." });
      log("request.error", { type: err?.name ?? "Error", code: err?.code });
      res.status(500).json({
        error:
          "Unexpected error. Use the request ID when reporting this issue.",
      });
    },
  );
  return app;
}
