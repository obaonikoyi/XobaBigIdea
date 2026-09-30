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
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", stop_reason, stop_sequence: null,
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
    expect(costUsd).toBeCloseTo((1000 * 5 + 200 * 25) / 1e6);
    const req = calls[0];
    expect(req.url).toContain("/v1/messages");
    expect(req.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(req.body).toMatchObject({ model: "claude-opus-5", fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(JSON.stringify(req.body.messages)).toContain("rain dey fall");
  });

  it("treats a refusal as a non-retryable failure", async () => {
    const { f } = stub(message("", "refusal"));
    await expect(anthropicEnricher({ apiKey: "k", fetch: f }).enrich({ words: [{ kind: "capture", text: "x" }], wantQuestions: false })).rejects.toMatchObject({ retryable: false });
  });
});
