import type { SqlDb } from "./sql.js";

/** Node's built-in SQLite (node:sqlite). Zero extra dependencies. Use ":memory:" for tests. */
export async function openNodeSqlite(path: string): Promise<SqlDb> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  return {
    name: "sqlite",
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as never[]));
    },
  };
}
