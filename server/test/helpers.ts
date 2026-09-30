import type { Idea } from "@xoba/shared";
import { createApp, type AppDeps } from "../src/app.js";
import { SqlIdeaStore } from "../src/providers/sql.js";
import { openNodeSqlite } from "../src/providers/sqlite-node.js";
import { memoryBlobStore } from "../src/providers/blobs.js";
import { fakeEnricher, fakeTranscriber } from "../src/providers/offline.js";

export function makeIdea(over: Partial<Idea> = {}): Idea {
  const t = "2026-09-01T10:00:00.000Z";
  return {
    id: "idea1",
    createdAt: t,
    tzOffsetMin: 60,
    updatedAt: t,
    status: "captured",
    priority: null,
    title: { value: "", source: "ai" },
    type: { value: "other", source: "ai" },
    summary: { value: "", source: "ai" },
    entries: [{ id: "e1", createdAt: t, kind: "capture", text: "Omo, song about Lagos rain", transcriptStatus: "none" }],
    followUps: [],
    ...over,
  };
}

export async function makeApp(over: Partial<AppDeps> = {}) {
  const store = new SqlIdeaStore(await openNodeSqlite(":memory:"));
  await store.init();
  const deps: AppDeps = {
    store,
    blobs: memoryBlobStore(),
    enricher: fakeEnricher(),
    transcriber: fakeTranscriber(),
    capUsd: 5,
    ...over,
  };
  const app = createApp(deps);
  const call = (path: string, init: RequestInit = {}) => app.request(path, init);
  const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return { app, deps, store, call, json };
}
