import express from "express";
import { z, ZodError } from "zod";
import { AppError, Store } from "./domain.js";
import path from "node:path";
export function createApp(
  store: Store,
  options: { secureCookies?: boolean; demo?: boolean } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
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
  const token = (req: express.Request) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("ledger_session="));
    return raw?.slice("ledger_session=".length) ?? "";
  };
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", demo: options.demo !== false }),
  );
  const attempts = new Map<string, { count: number; until: number }>();
  app.post("/api/login", (req, res) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    for (const [id, entry] of attempts)
      if (entry.until < now) attempts.delete(id);
    const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
    if (entry.count >= 20)
      throw new AppError(
        429,
        "Too many sign-in attempts. Try again in a minute.",
      );
    entry.count++;
    attempts.set(key, entry);
    const input = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const { token, user } = store.login(input.email, input.password);
    res
      .cookie("ledger_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookies ?? false,
        maxAge: 8 * 60 * 60 * 1000,
        path: "/",
      })
      .json({ user });
  });
  app.use("/api", (req, res, next) => {
    const user = store.user(token(req));
    if (!user) return next(new AppError(401, "Sign in to continue."));
    res.locals.user = user;
    next();
  });
  app.post("/api/logout", (req, res) => {
    store.logout(token(req));
    res.clearCookie("ledger_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/workspace", (_req, res) =>
    res.json(store.snapshot(res.locals.user)),
  );
  app.post("/api/payments", (req, res) =>
    res
      .status(201)
      .json(
        store.create(
          res.locals.user,
          req.body,
          req.get("Idempotency-Key") ?? "",
        ),
      ),
  );
  app.post("/api/payments/:id/review", (req, res) => {
    const body = z
      .object({
        action: z.enum(["approve", "reject"]),
        version: z.number().int().positive(),
        reason: z.string().max(300).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      store.review(
        res.locals.user,
        String(req.params.id),
        body.action,
        body.version,
        body.reason,
      ),
    );
  });
  app.post("/api/payments/:id/retry", (req, res) =>
    res.json(store.retry(res.locals.user, String(req.params.id))),
  );
  app.post("/api/provider", (req, res) => {
    if (options.demo === false)
      throw new AppError(404, "Simulator controls are disabled.");
    const body = z.object({ mode: z.string() }).strict().parse(req.body);
    store.setMode(res.locals.user, body.mode);
    res.json({ mode: store.mode() });
  });
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "API route not found.")),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
  app.use(
    (
      err: unknown,
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
      console.error(err);
      res
        .status(500)
        .json({ error: "An unexpected error occurred. Please try again." });
    },
  );
  return app;
}
