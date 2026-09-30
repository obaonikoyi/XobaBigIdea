import type { SqlDb } from "./sql.js";

/** Postgres via `pg`. Converts `?` placeholders to `$1, $2, ...`. */
export async function openPostgres(connectionString: string): Promise<SqlDb & { close(): Promise<void> }> {
  const pg = await import("pg");
  const Pool = pg.default?.Pool ?? pg.Pool;
  const pool = new Pool({ connectionString });
  const convert = (sql: string) => {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  };
  return {
    name: "postgres",
    async all<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(convert(sql), params);
      return r.rows as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      await pool.query(convert(sql), params);
    },
    close: () => pool.end(),
  };
}
