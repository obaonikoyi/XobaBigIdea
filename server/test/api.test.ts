import { describe, expect, it } from "vitest";
import { makeApp, makeIdea } from "./helpers.js";
import { noEnricher, noTranscriber } from "../src/providers/offline.js";
import { ProviderError, type Enricher } from "../src/providers/types.js";

describe("ideas sync", () => {
  it("stores and lists ideas, keeping the newer copy (last write wins)", async () => {
    const { call, json } = await makeApp();
    const v1 = makeIdea({ updatedAt: "2026-09-01T10:00:00.000Z", status: "captured" });
    const v2 = makeIdea({ updatedAt: "2026-09-02T10:00:00.000Z", status: "chosen" });
    expect((await call("/api/ideas/idea1", json("PUT", v2))).status).toBe(200);
    // An older copy arriving later must not overwrite the newer one.
    const res = await call("/api/ideas/idea1", json("PUT", v1));
    expect((await res.json()).status).toBe("chosen");
    const list = await (await call("/api/ideas")).json();
    expect(list.ideas).toHaveLength(1);
    expect(list.ideas[0].status).toBe("chosen");
    expect(typeof list.serverTime).toBe("string");
  });

  it("lists only ideas changed since a server time", async () => {
    let t = new Date("2026-09-01T00:00:00Z");
    const { call, json } = await makeApp({ now: () => t });
    await call("/api/ideas/a", json("PUT", makeIdea({ id: "a" })));
    t = new Date("2026-09-05T00:00:00Z");
    await call("/api/ideas/b", json("PUT", makeIdea({ id: "b" })));
    const list = await (await call("/api/ideas?since=2026-09-03T00:00:00.000Z")).json();
    expect(list.ideas.map((i: { id: string }) => i.id)).toEqual(["b"]);
  });

  it("rejects invalid ideas and mismatched ids", async () => {
    const { call, json } = await makeApp();
    expect((await call("/api/ideas/x", json("PUT", { id: "x" }))).status).toBe(400);
    expect((await call("/api/ideas/other", json("PUT", makeIdea()))).status).toBe(400);
    expect((await call("/api/ideas/..%2Fetc", json("PUT", makeIdea({ id: "../etc" })))).status).toBe(400);
  });
});

describe("audio", () => {
  it("stores audio once and never overwrites the original", async () => {
    const { call } = await makeApp();
    const put = (bytes: number[]) => call("/api/audio/aud1", { method: "PUT", body: new Uint8Array(bytes), headers: { "Content-Type": "audio/webm" } });
    expect((await put([1, 2, 3])).status).toBe(200);
    await put([9, 9]);
    const res = await call("/api/audio/aud1");
    expect(res.headers.get("Content-Type")).toBe("audio/webm");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await call("/api/audio/aud1", { method: "HEAD" })).status).toBe(200);
    expect((await call("/api/audio/nope", { method: "HEAD" })).status).toBe(404);
  });
});

describe("auth", () => {
  it("requires the app token when one is configured", async () => {
    const { call } = await makeApp({ appToken: "secret" });
    expect((await call("/api/ideas")).status).toBe(401);
    expect((await call("/api/ideas", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await call("/api/ideas", { headers: { Authorization: "Bearer secret" } })).status).toBe(200);
    expect((await call("/api/ping")).status).toBe(200);
  });
});

describe("AI and the spending cap", () => {
  const enrichBody = { words: [{ kind: "capture", text: "chorus for a new song" }], wantQuestions: true };

  it("enriches and records spend", async () => {
    const { call, json, store } = await makeApp();
    const res = await call("/api/enrich", json("POST", enrichBody));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.type).toBe("song");
    expect(r.questions.length).toBeLessThanOrEqual(2);
    expect(await store.monthSpendUsd(new Date().toISOString().slice(0, 7))).toBeCloseTo(0.01);
  });

  it("refuses paid calls once the monthly cap is reached, while sync keeps working", async () => {
    const { call, json } = await makeApp({ capUsd: 0.015 });
    expect((await call("/api/enrich", json("POST", enrichBody))).status).toBe(200);
    expect((await call("/api/enrich", json("POST", enrichBody))).status).toBe(200); // 0.01 < 0.015
    const blocked = await call("/api/enrich", json("POST", enrichBody));
    expect(blocked.status).toBe(402);
    expect((await blocked.json()).error).toBe("over_cap");
    const health = await (await call("/api/health")).json();
    expect(health.ai.spend.overCap).toBe(true);
    expect(health.ai.enrich.available).toBe(false);
    // Capture and sync are unaffected.
    expect((await call("/api/ideas/idea1", json("PUT", makeIdea()))).status).toBe(200);
  });

  it("cap of 0 switches AI off", async () => {
    const { call, json } = await makeApp({ capUsd: 0 });
    expect((await call("/api/enrich", json("POST", enrichBody))).status).toBe(402);
  });

  it("reports unavailable AI without breaking anything", async () => {
    const { call, json } = await makeApp({ enricher: noEnricher(), transcriber: noTranscriber() });
    const res = await call("/api/enrich", json("POST", enrichBody));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("ai_unavailable");
    const health = await (await call("/api/health")).json();
    expect(health.ai.enrich.available).toBe(false);
    expect(health.ai.transcribe.available).toBe(false);
    expect((await call("/api/ideas/idea1", json("PUT", makeIdea()))).status).toBe(200);
  });

  it("turns provider crashes into a clean error", async () => {
    const broken: Enricher = {
      name: "broken",
      unavailableReason: () => undefined,
      enrich: async () => {
        throw new ProviderError("upstream 529");
      },
    };
    const { call, json } = await makeApp({ enricher: broken });
    const res = await call("/api/enrich", json("POST", enrichBody));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("provider_error");
  });

  it("transcribes uploaded audio", async () => {
    const { call } = await makeApp();
    expect((await call("/api/transcribe/aud9", { method: "POST" })).status).toBe(404);
    await call("/api/audio/aud9", { method: "PUT", body: new Uint8Array([1, 2, 3, 4]), headers: { "Content-Type": "audio/webm" } });
    const res = await call("/api/transcribe/aud9?durationMs=3000", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toContain("4 bytes");
  });
});
