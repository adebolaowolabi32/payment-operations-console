import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { Database } from "../server/db.js";
import { Store, demoUsers, type User, AppError } from "../server/domain.js";
export const [maker, checker, admin, viewer]: User[] = demoUsers.map((u) => ({
  ...u,
  org_id: "org_cedar",
}));
export const input = {
  beneficiaryId: "ben_atlas",
  amount: "1234.56",
  reference: "Invoice testing",
};
export const code = (status: number) => (e: unknown) =>
  e instanceof AppError && e.status === status;
export async function fixture(t: TestContext) {
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const root = new Database(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  );
  await root.query(`CREATE SCHEMA ${schema}`);
  const db = new Database(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
    schema,
  );
  t.after(async () => {
    await db.close();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.close();
  });
  await db.migrate();
  let clock = Date.now();
  const store = new Store(db, () => clock);
  await store.seed("test-password", false);
  return { store, db, schema, advance: (n = 60000) => (clock += n) };
}
