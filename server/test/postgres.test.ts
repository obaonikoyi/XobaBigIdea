// Runs only when PG_TEST_URL is set, e.g. postgres://postgres:postgres@localhost:5432/xoba_test
import { describe, expect, it } from "vitest";
import { SqlIdeaStore } from "../src/providers/sql.js";
import { openPostgres } from "../src/providers/postgres.js";
import { makeIdea } from "./helpers.js";

const url = process.env.PG_TEST_URL;

describe.skipIf(!url)("postgres store", () => {
  it("round-trips ideas with last-write-wins and tracks spend", async () => {
    const db = await openPostgres(url!);
    await db.run("DROP TABLE IF EXISTS ideas");
    await db.run("DROP TABLE IF EXISTS ai_usage");
    const store = new SqlIdeaStore(db);
    await store.init();
    await store.putIdea(makeIdea({ updatedAt: "2026-09-02T00:00:00.000Z", status: "later" }), "2026-09-02T00:00:00.000Z");
    const kept = await store.putIdea(makeIdea({ updatedAt: "2026-09-01T00:00:00.000Z" }), "2026-09-03T00:00:00.000Z");
    expect(kept.status).toBe("later");
    expect(await store.listIdeas("2026-09-01T00:00:00.000Z")).toHaveLength(1);
    await store.recordUsage({ id: "u1", at: "x", month: "2026-09", kind: "enrich", provider: "p", costUsd: 0.25 });
    await store.recordUsage({ id: "u2", at: "x", month: "2026-09", kind: "enrich", provider: "p", costUsd: 0.5 });
    expect(await store.monthSpendUsd("2026-09")).toBeCloseTo(0.75);
    await db.close();
  });
});
