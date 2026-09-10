import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
pg.types.setTypeParser(20, Number);
export type Queryable = Pick<pg.Pool, "query">;
export class Database {
  pool: pg.Pool;
  constructor(
    url = process.env.DATABASE_URL ??
      "postgresql://ledgerdesk:ledgerdesk@127.0.0.1:5432/ledgerdesk",
    schema = process.env.DB_SCHEMA ?? "public",
  ) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid database schema");
    this.pool = new pg.Pool({
      connectionString: url,
      max: 12,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema},public -c statement_timeout=10000`,
    });
  }
  async query<T = any>(sql: string, args: any[] = []): Promise<T[]> {
    return (await this.pool.query(sql, args)).rows;
  }
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async migrate() {
    await this.tx(async (q) => {
      await q.query(
        "SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':ledgerdesk-migrations'))",
      );
      await q.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const file of (
        await readdir(new URL("./migrations/", import.meta.url))
      )
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        const sql = await readFile(
          new URL("./migrations/" + file, import.meta.url),
          "utf8",
        );
        const checksum = createHash("sha256").update(sql).digest("hex");
        const old = (
          await q.query(
            "SELECT checksum FROM schema_migrations WHERE version=$1",
            [file],
          )
        ).rows[0];
        if (old) {
          if (old.checksum !== checksum)
            throw new Error("Migration checksum mismatch: " + file);
          continue;
        }
        await q.query(sql);
        await q.query(
          "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
          [file, checksum],
        );
      }
    });
  }
  close() {
    return this.pool.end();
  }
}
export async function one<T = any>(
  q: Queryable,
  sql: string,
  args: any[] = [],
): Promise<T | undefined> {
  return (await q.query(sql, args)).rows[0];
}
