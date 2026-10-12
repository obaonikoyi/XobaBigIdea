import { describe, expect, it } from "vitest";
import { anthropicEnricher } from "../src/providers/anthropic.js";

function stub(reply: Record<string, unknown>) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const message = (text: string, stop_reason = "end_turn") => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, stop_sequence: null,
  content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 200 },
});

describe("anthropic enricher", () => {
  it("is unavailable without a key", () => {
    expect(anthropicEnricher({}).unavailableReason()).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("sends a structured-output request and prices it from usage", async () => {
    const { f, calls } = stub(message(JSON.stringify({ title: "Rain song", type: "song", summary: "A song.", questions: ["Who?"] })));
    const e = anthropicEnricher({ apiKey: "k", fetch: f });
    const { result, costUsd } = await e.enrich({ words: [{ kind: "capture", text: "rain dey fall" }], wantQuestions: true });
    expect(result).toMatchObject({ title: "Rain song", type: "song", questions: ["Who?"] });
    expect(costUsd).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6);
    const req = calls[0];
    expect(req.url).toContain("/v1/messages");
    expect(req.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(req.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(JSON.stringify(req.body.messages)).toContain("rain dey fall");
  });

  it("treats a refusal as a non-retryable failure", async () => {
    const { f } = stub(message("", "refusal"));
    await expect(anthropicEnricher({ apiKey: "k", fetch: f }).enrich({ words: [{ kind: "capture", text: "x" }], wantQuestions: false })).rejects.toMatchObject({ retryable: false });
  });

  it("writes a take with a structured schema at medium effort, including chat clarifications", async () => {
    const take = { whatYouMean: "A cheap okada booking app.", strengths: ["Real need"], risks: ["Regulation"], opinion: "Worth testing.", nextSteps: ["Ask 5 riders"] };
    const { f, calls } = stub(message(JSON.stringify(take)));
    const { result, costUsd } = await anthropicEnricher({ apiKey: "k", fetch: f }).take({
      words: [{ kind: "capture", text: "okada app, abeg make e cheap" }],
      title: "Okada app",
      chat: [{ role: "me", text: "It is for students" }],
    });
    expect(result).toMatchObject({ ...take, provider: "anthropic:claude-opus-5-5" });
    expect(costUsd).toBeGreaterThan(0);
    const body = calls[0].body as { output_config: { effort: string; format: { schema: { required: string[] } } }; messages: unknown; system: string };
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.schema.required).toContain("opinion");
    expect(JSON.stringify(body.messages)).toContain("abeg make e cheap");
    expect(JSON.stringify(body.messages)).toContain("It is for students");
    expect(body.system).toMatch(/opinion/);
  });

  it("chats with the idea and the earlier take as context", async () => {
    const { f, calls } = stub(message("Students are a good start. Who pays?"));
    const { result } = await anthropicEnricher({ apiKey: "k", fetch: f }).chat({
      words: [{ kind: "capture", text: "okada app" }],
      take: { whatYouMean: "Booking app", strengths: [], risks: [], opinion: "Test it", nextSteps: [] },
      messages: [
        { role: "me", text: "Is this good?" },
        { role: "ai", text: "Maybe." },
        { role: "me", text: "Why maybe?" },
      ],
    });
    expect(result.reply).toBe("Students are a good start. Who pays?");
    const body = calls[0].body as { messages: { role: string; content: string }[]; system: string; output_config: Record<string, unknown> };
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(body.system).toContain("okada app");
    expect(body.system).toContain("Booking app");
    expect(body.output_config.format).toBeUndefined();
  });

  it("does not retry a take the model returned in a broken shape, but still counts its cost", async () => {
    const { f } = stub(message("not json at all"));
    await expect(anthropicEnricher({ apiKey: "k", fetch: f }).take({ words: [{ kind: "capture", text: "x" }] })).rejects.toMatchObject({ retryable: false, costUsd: expect.any(Number) });
  });
});
