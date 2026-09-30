import { describe, expect, it } from "vitest";
import { normalizeEnrich, enrichSystemPrompt } from "../src/providers/prompt.js";

describe("normalizeEnrich", () => {
  it("clamps questions to 2 and falls back to 'other' for unknown types", () => {
    const r = normalizeEnrich({ title: "T", type: "poem", summary: "S", questions: ["a", "b", "c"] }, "p", true);
    expect(r.questions).toEqual(["a", "b"]);
    expect(r.type).toBe("other");
  });
  it("drops questions when not wanted", () => {
    expect(normalizeEnrich({ title: "T", type: "song", summary: "S", questions: ["a"] }, "p", false).questions).toEqual([]);
  });
  it("extracts JSON from text", () => {
    expect(normalizeEnrich('Here: {"title":"Rain","type":"song","summary":"x","questions":[]}', "p", true).title).toBe("Rain");
  });
  it("rejects empty output", () => {
    expect(() => normalizeEnrich({}, "p", true)).toThrow();
  });
  it("tells the model never to rewrite lyrics, Pidgin or Yoruba", () => {
    expect(enrichSystemPrompt({ words: [], wantQuestions: true })).toMatch(/Never rewrite.*lyrics, Pidgin or Yoruba/);
  });
});
