import type { Idea } from "@xoba/shared";
import type { IdeaStore, UsageRecord } from "./types.js";

/**
 * Minimal async SQL interface. Queries are written with `?` placeholders in a
 * dialect that SQLite, Cloudflare D1 and Postgres all accept.
 */
export interface SqlDb {
  readonly name: string;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ideas (
     id TEXT PRIMARY KEY,
     updated_at TEXT NOT NULL,
     synced_at TEXT NOT NULL,
     data TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ideas_synced_at ON ideas (synced_at)`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
     id TEXT PRIMARY KEY,
     at TEXT NOT NULL,
     month TEXT NOT NULL,
     kind TEXT NOT NULL,
     provider TEXT NOT NULL,
     cost_usd DOUBLE PRECISION NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ai_usage_month ON ai_usage (month)`,
];

export class SqlIdeaStore implements IdeaStore {
  constructor(private db: SqlDb) {}

  get name() {
    return this.db.name;
  }

  async init() {
    for (const stmt of SCHEMA) await this.db.run(stmt);
  }

  async putIdea(idea: Idea, serverTime: string): Promise<Idea> {
    await this.db.run(
      `INSERT INTO ideas (id, updated_at, synced_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         updated_at = excluded.updated_at,
         synced_at = excluded.synced_at,
         data = excluded.data
       WHERE ideas.updated_at < excluded.updated_at`,
      [idea.id, idea.updatedAt, serverTime, JSON.stringify(idea)],
    );
    return (await this.getIdea(idea.id)) ?? idea;
  }

  async getIdea(id: string): Promise<Idea | null> {
    const rows = await this.db.all<{ data: string }>(`SELECT data FROM ideas WHERE id = ?`, [id]);
    return rows[0] ? (JSON.parse(rows[0].data) as Idea) : null;
  }

  async listIdeas(since?: string) {
    const rows = since
      ? await this.db.all<{ data: string; synced_at: string }>(
          `SELECT data, synced_at FROM ideas WHERE synced_at >= ? ORDER BY synced_at`,
          [since],
        )
      : await this.db.all<{ data: string; synced_at: string }>(`SELECT data, synced_at FROM ideas ORDER BY synced_at`);
    return rows.map((r) => ({ idea: JSON.parse(r.data) as Idea, syncedAt: r.synced_at }));
  }

  async recordUsage(u: UsageRecord) {
    await this.db.run(
      `INSERT INTO ai_usage (id, at, month, kind, provider, cost_usd) VALUES (?, ?, ?, ?, ?, ?)`,
      [u.id, u.at, u.month, u.kind, u.provider, u.costUsd],
    );
  }

  async monthSpendUsd(month: string) {
    const rows = await this.db.all<{ total: number | string | null }>(
      `SELECT SUM(cost_usd) AS total FROM ai_usage WHERE month = ?`,
      [month],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
