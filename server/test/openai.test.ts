import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiTranscriber, PIDGIN_HINT } from "../src/providers/openai-transcribe.js";

afterEach(() => vi.unstubAllGlobals());

describe("openai transcriber", () => {
  it("sends the language and, for English, the Pidgin vocabulary hint", async () => {
    const forms: FormData[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return new Response(JSON.stringify({ text: "wetin dey happen" }), { status: 200 });
    });
    const t = openaiTranscriber({ apiKey: "k" });
    const r = await t.transcribe(new Uint8Array([1, 2]), "audio/webm", 60_000, "en");
    expect(r.result.text).toBe("wetin dey happen");
    expect(r.costUsd).toBeCloseTo(0.006);
    expect(forms[0].get("language")).toBe("en");
    expect(forms[0].get("prompt")).toBe(PIDGIN_HINT);

    await t.transcribe(new Uint8Array([1]), "audio/webm", 1000, "yo");
    expect(forms[1].get("language")).toBe("yo");
    expect(forms[1].get("prompt")).toBeNull();
  });
});
