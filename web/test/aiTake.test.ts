// The AI take and "talk it through", against the real server app in process.
import { describe, expect, it } from "vitest";
import * as db from "../src/lib/db";
import { setFetch } from "../src/lib/api";
import { addThought, createIdea, requestNewTake, setStatus } from "../src/lib/ideas";
import { syncNow } from "../src/lib/sync";
import { awaitingReply, sendChat } from "../src/lib/chat";
import { createApp, type AppDeps } from "../../server/src/app";
import { SqlIdeaStore } from "../../server/src/providers/sql";
import { openNodeSqlite } from "../../server/src/providers/sqlite-node";
import { memoryBlobStore } from "../../server/src/providers/blobs";
import { fakeEnricher, fakeTranscriber, noEnricher } from "../../server/src/providers/offline";
import type { Enricher } from "../../server/src/providers/types";

async function startServer(over: Partial<AppDeps> = {}) {
  const store = new SqlIdeaStore(await openNodeSqlite(":memory:"));
  await store.init();
  const deps: AppDeps = { store, blobs: memoryBlobStore(), enricher: fakeEnricher(), transcriber: fakeTranscriber(), capUsd: 5, ...over };
  let app = createApp(deps);
  setFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return app.request(url.startsWith("http") ? url : `http://local${url}`, init);
  }) as typeof fetch);
  return { deps, rebuild: (o: Partial<AppDeps>) => (app = createApp(Object.assign(deps, o))) };
}

/** Fake enricher that counts take calls and records what the chat received. */
function counting() {
  const fake = fakeEnricher();
  const calls = { take: 0, chat: [] as string[][] };
  const e: Enricher = {
    ...fake,
    take: (req) => (calls.take++, fake.take(req)),
    chat: (req) => (calls.chat.push(req.messages.map((m) => `${m.role}:${m.text}`)), fake.chat(req)),
  };
  return { e, calls };
}

describe("AI take", () => {
  it("writes a take after capture, keeps my words untouched, and syncs it to the server", async () => {
    const { deps } = await startServer();
    const idea = await createIdea({ text: "Okada app wey go cheap for students" });
    await syncNow();
    const local = await db.getIdea(idea.id);
    expect(local?.take?.whatYouMean).toContain("Okada app");
    expect(local?.take?.opinion).toBeTruthy();
    expect(local?.take?.basedOnEntries).toBe(1);
    expect(local?.entries[0].text).toBe("Okada app wey go cheap for students");
    expect((await deps.store.getIdea(idea.id))?.take?.opinion).toBeTruthy();
  });

  it("rewrites the take only when I add something new, or when I ask", async () => {
    const { e, calls } = counting();
    await startServer({ enricher: e });
    const idea = await createIdea({ text: "Song about Lagos rain" });
    await syncNow();
    await syncNow();
    expect(calls.take).toBe(1);
    await addThought(idea.id, { text: "Make the hook in Yoruba" });
    await syncNow();
    expect(calls.take).toBe(2);
    expect((await db.getIdea(idea.id))?.take?.basedOnEntries).toBe(2);
    await requestNewTake(idea.id);
    await syncNow();
    expect(calls.take).toBe(3);
  });

  it("leaves archived ideas alone and waits quietly while AI is off", async () => {
    const { e, calls } = counting();
    const server = await startServer({ enricher: noEnricher() });
    const a = await createIdea({ text: "Old idea" });
    await setStatus(a.id, "archived");
    const b = await createIdea({ text: "New idea" });
    await syncNow();
    expect((await db.getIdea(b.id))?.take).toBeUndefined();
    server.rebuild({ enricher: e });
    await syncNow();
    expect((await db.getIdea(b.id))?.take).toBeDefined();
    expect((await db.getIdea(a.id))?.take).toBeUndefined();
    expect(calls.take).toBe(1);
  });

  it("stops retrying when the AI cannot write a take for an idea", async () => {
    let n = 0;
    const fake = fakeEnricher();
    const { ProviderError } = await import("../../server/src/providers/types");
    await startServer({
      enricher: {
        ...fake,
        take: async () => {
          n++;
          throw new ProviderError("declined", false);
        },
      },
    });
    const idea = await createIdea({ text: "Something odd" });
    await syncNow();
    await syncNow();
    expect(n).toBe(1);
    expect((await db.getIdea(idea.id))?.take?.failed).toBe(true);
  });
});

describe("talk it through", () => {
  it("saves my message, gets a reply, and sends the conversation so far", async () => {
    const { e, calls } = counting();
    const { deps } = await startServer({ enricher: e });
    const idea = await createIdea({ text: "Okada app" });
    await syncNow();
    await sendChat(idea.id, "Who would pay for this?");
    await sendChat(idea.id, "And students?");
    const local = await db.getIdea(idea.id);
    expect(local?.chat?.map((m) => m.role)).toEqual(["me", "ai", "me", "ai"]);
    expect(local?.chat?.[1].text).toContain("Who would pay");
    expect(calls.chat[1]).toEqual(["me:Who would pay for this?", `ai:${local?.chat?.[1].text}`, "me:And students?"]);
    await syncNow();
    expect((await deps.store.getIdea(idea.id))?.chat).toHaveLength(4);
  });

  it("keeps my message when the AI is down and replies to it once it is back", async () => {
    const server = await startServer({ enricher: noEnricher() });
    const idea = await createIdea({ text: "Okada app" });
    await expect(sendChat(idea.id, "Is this worth it?")).rejects.toThrow();
    let local = await db.getIdea(idea.id);
    expect(local?.chat).toHaveLength(1);
    expect(awaitingReply(local!)).toBe(true);
    server.rebuild({ enricher: fakeEnricher() });
    await sendChat(idea.id, "");
    local = await db.getIdea(idea.id);
    expect(local?.chat?.map((m) => m.role)).toEqual(["me", "ai"]);
    expect(awaitingReply(local!)).toBe(false);
  });
});
