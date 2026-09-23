import type { D1Database } from "@cloudflare/workers-types";
import type { SqlDb } from "./sql.js";

/** Cloudflare D1 (free tier friendly). */
export function d1Db(db: D1Database): SqlDb {
  return {
    name: "cloudflare-d1",
    async all<T>(sql: string, params: unknown[] = []) {
      const r = await db.prepare(sql).bind(...params).all<T>();
      return r.results;
    },
    async run(sql: string, params: unknown[] = []) {
      await db.prepare(sql).bind(...params).run();
    },
  };
}
