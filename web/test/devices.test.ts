// Two devices (separate local databases) signing in to the same server.
import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import * as db from "../src/lib/db";
import { auth, getSettings, setFetch } from "../src/lib/api";
import { createIdea } from "../src/lib/ideas";
import { getSyncState, loadAudio, syncNow } from "../src/lib/sync";
import { createApp } from "../../server/src/app";
import { SqlIdeaStore } from "../../server/src/providers/sql";
import { openNodeSqlite } from "../../server/src/providers/sqlite-node";
import { memoryBlobStore } from "../../server/src/providers/blobs";
import { fakeEnricher, fakeTranscriber } from "../../server/src/providers/offline";

async function server() {
  const store = new SqlIdeaStore(await openNodeSqlite(":memory:"));
  await store.init();
  const app = createApp({ store, blobs: memoryBlobStore(), enricher: fakeEnricher(), transcriber: fakeTranscriber(), capUsd: 5, appPassword: "my secret" });
  setFetch(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return app.request(url.startsWith("http") ? url : `http://local${url}`, init);
  }) as typeof fetch);
}

/** Switch to a different "device": a fresh, empty local database. */
async function switchDevice() {
  await db.closeDb();
  globalThis.indexedDB = new IDBFactory();
}

describe("signing in on two devices", () => {
  it("an idea captured on the laptop shows up on the phone, with its recording", async () => {
    await server();

    // Laptop: not signed in yet, so nothing syncs and the app asks to sign in.
    const idea = await createIdea({ text: "Afrobeat hook for Sunday", audio: { id: "lapaud", mime: "audio/webm", durationMs: 2000 } });
    await db.putAudio({ id: "lapaud", ideaId: idea.id, mime: "audio/webm", bytes: new Uint8Array([5, 6, 7]).buffer, durationMs: 2000, createdAt: idea.createdAt, uploaded: false });
    await syncNow();
    expect(getSyncState().authNeeded).toBe(true);

    await expect(auth.login("wrong")).rejects.toMatchObject({ status: 401 });
    await auth.login("my secret");
    await syncNow();
    expect(getSyncState().authNeeded).toBe(false);
    expect(await db.outboxIds()).toHaveLength(0);

    // Phone: fresh device, signs in, pulls everything.
    await switchDevice();
    expect(await db.allIdeas()).toHaveLength(0);
    await auth.login("my secret");
    await syncNow();
    const onPhone = await db.getIdea(idea.id);
    expect(onPhone?.entries[0].text).toBe("Afrobeat hook for Sunday");
    const audio = await loadAudio("lapaud", idea.id);
    expect([...new Uint8Array(audio!.bytes)]).toEqual([5, 6, 7]);

    // Signing out on the phone keeps its local copy but stops syncing.
    await auth.logout();
    expect((await getSettings()).token).toBe("");
    await syncNow();
    expect(getSyncState().authNeeded).toBe(true);
    expect(await db.getIdea(idea.id)).toBeTruthy();
  });
});
