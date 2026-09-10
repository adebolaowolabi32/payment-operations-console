import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { Store } from "../server/domain.js";
import type { AddressInfo } from "node:net";
test("HTTP boundary enforces login, mutation headers, role permissions, and cookie revocation", async (t) => {
  const store = new Store(":memory:");
  store.seed("test-password", false);
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const post = (path: string, body: unknown, cookie = "", header = true) =>
    fetch(base + "/api" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(header ? { "X-Requested-With": "LedgerDesk" } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(base + "/api/workspace")).status, 401);
  assert.equal(
    (
      await post(
        "/login",
        { email: "alex@ledgerdesk.demo", password: "test-password" },
        "",
        false,
      )
    ).status,
    403,
  );
  const login = await post("/login", {
    email: "alex@ledgerdesk.demo",
    password: "test-password",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const session = cookie.split(";")[0];
  assert.equal(
    (await fetch(base + "/api/workspace", { headers: { Cookie: session } }))
      .status,
    200,
  );
  assert.equal(
    (
      await post(
        "/payments",
        { beneficiaryId: "ben_atlas", amount: "10", reference: "Test payment" },
        session,
      )
    ).status,
    403,
  );
  assert.equal(
    (await post("/provider", { mode: "offline" }, session)).status,
    403,
  );
  await post("/logout", {}, session);
  assert.equal(
    (await fetch(base + "/api/workspace", { headers: { Cookie: session } }))
      .status,
    401,
  );
});
