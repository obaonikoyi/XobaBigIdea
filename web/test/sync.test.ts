// End-to-end: the web client syncing against the real server app, in process.
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "../src/lib/db";
import { setFetch } from "../src/lib/api";
import { createIdea } from "../src/lib/ideas";
import { loadAudio, syncNow, getSyncState } from "../src/lib/sync";
import { createApp, type AppDeps } from "../../server/src/app";
import { SqlIdeaStore } from "../../server/src/providers/sql";
import { openNodeSqlite } from "../../server/src/providers/sqlite-node";
import { memoryBlobStore } from "../../server/src/providers/blobs";
import { fakeEnricher, fakeTranscriber, noEnricher, noTranscriber } from "../../server/src/providers/offline";

let deps: AppDeps;
let serverUp = true;

async function startServer(over: Partial<AppDeps> = {}) {
  const store = new SqlIdeaStore(await openNodeSqlite(":memory:"));
  await store.init();
  deps = { store, blobs: memoryBlobStore(), enricher: fakeEnricher(), transcriber: fakeTranscriber(), capUsd: 5, ...over };
  let app = createApp(deps);
  setFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!serverUp) throw new TypeError("Failed to fetch");
    const url = typeof input === "string" ? input : input.toString();
    return app.request(url.startsWith("http") ? url : `http://local${url}`, init);
  }) as typeof fetch);
  return { rebuild: (o: Partial<AppDeps>) => (app = createApp(Object.assign(deps, o))) };
}

async function voiceIdea(text = "") {
  const idea = await createIdea({ text, audio: { id: "aud" + Math.random().toString(36).slice(2, 8), mime: "audio/webm", durationMs: 3000 } });
  const e = idea.entries[0];
  await db.putAudio({ id: e.audioId!, ideaId: idea.id, mime: "audio/webm", bytes: new Uint8Array([1, 2, 3]).buffer, durationMs: 3000, createdAt: idea.createdAt, uploaded: false });
  return idea;
}

beforeEach(() => {
  serverUp = true;
});

describe("sync", () => {
  it("captures offline, then syncs, transcribes and builds the card when back online", async () => {
    await startServer();
    serverUp = false;
    const idea = await voiceIdea("Hook: omo see wahala");
    await syncNow();
    expect(getSyncState().serverReachable).toBe(false);
    expect(await db.getIdea(idea.id)).toBeTruthy(); // still there, still capturable
    expect(await db.outboxIds()).toContain(idea.id);

    serverUp = true;
    await syncNow();
    const local = await db.getIdea(idea.id);
    expect(local?.entries[0].transcript).toBe("(fake transcript of 3 bytes)");
    expect(local?.entries[0].text).toBe("Hook: omo see wahala"); // original untouched
    expect(local?.ai?.provider).toBe("fake");
    expect(local?.followUps.length).toBeLessThanOrEqual(2);
    expect(await db.outboxIds()).toHaveLength(0);
    expect((await db.getAudio(local!.entries[0].audioId!))?.uploaded).toBe(true);
    const onServer = await deps.store.getIdea(idea.id);
    expect(onServer?.ai?.provider).toBe("fake");
    expect(await deps.blobs.has(local!.entries[0].audioId!)).toBe(true);
  });

  it("keeps working while AI is down, and catches up once it is back", async () => {
    const server = await startServer({ enricher: noEnricher(), transcriber: noTranscriber() });
    const idea = await voiceIdea();
    await syncNow();
    let local = await db.getIdea(idea.id);
    expect(local?.entries[0].transcriptStatus).toBe("pending");
    expect(local?.ai).toBeUndefined();
    expect(await deps.store.getIdea(idea.id)).toBeTruthy(); // synced anyway
    expect(await loadAudio(local!.entries[0].audioId!, idea.id)).toBeTruthy(); // replay works

    server.rebuild({ enricher: fakeEnricher(), transcriber: fakeTranscriber() });
    await syncNow();
    local = await db.getIdea(idea.id);
    expect(local?.entries[0].transcriptStatus).toBe("done");
    expect(local?.ai).toBeDefined();
  });

  it("stops calling AI once the monthly cap is reached", async () => {
    // fake: transcribe 0.001 + enrich 0.01 per voice idea. The cap is checked before each call.
    await startServer({ capUsd: 0.011 });
    await voiceIdea("one");
    await syncNow();
    const second = await createIdea({ text: "two" });
    await syncNow();
    expect((await db.getIdea(second.id))?.ai).toBeUndefined();
    expect(getSyncState().ai?.spend.overCap).toBe(true);
    expect(await deps.store.getIdea(second.id)).toBeTruthy();
  });

  it("pulls ideas captured on another device and downloads their audio on replay", async () => {
    await startServer();
    const t = new Date().toISOString();
    await deps.store.putIdea(
      {
        id: "remote1", createdAt: t, tzOffsetMin: 0, updatedAt: t, status: "later", priority: null,
        title: { value: "From my phone", source: "me" }, type: { value: "song", source: "me" }, summary: { value: "", source: "ai" },
        entries: [{ id: "e1", createdAt: t, kind: "capture", text: "", audioId: "remoteaud", audioMime: "audio/webm", transcriptStatus: "done", transcript: "la la" }],
        followUps: [],
      },
      t,
    );
    await deps.blobs.put("remoteaud", new Uint8Array([7, 7, 7]), "audio/webm");
    await syncNow();
    expect((await db.getIdea("remote1"))?.title.value).toBe("From my phone");
    expect(await db.getAudio("remoteaud")).toBeUndefined();
    const a = await loadAudio("remoteaud", "remote1");
    expect([...new Uint8Array(a!.bytes)]).toEqual([7, 7, 7]);
    expect(await db.getAudio("remoteaud")).toBeTruthy(); // now cached for offline replay
  });
});
