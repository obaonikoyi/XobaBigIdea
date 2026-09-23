import { IDEA_TYPES, isIdeaType, type EnrichRequest, type EnrichResult, type IdeaType } from "@xoba/shared";

export const ENRICH_SYSTEM = `You help one person keep a private notebook of ideas: songs, businesses, apps, stories, projects.
They capture ideas quickly by voice or text, often mixing English, Nigerian Pidgin and Yoruba.

From their words, suggest a short card:
- title: at most 8 words. You may use their own phrases. Do not translate Pidgin or Yoruba.
- type: one of ${IDEA_TYPES.join(", ")}. Lyrics, melodies, hooks and verses are "song".
- summary: 1-2 plain sentences describing what the idea is. Describe it; do not rewrite it.
- questions: ${"{Q}"}

Rules you must keep:
- Never rewrite, correct, "improve", complete or translate their words, lyrics, Pidgin or Yoruba. If you quote them, quote exactly.
- Do not write lyrics, verses, code, business plans or anything they did not say.
- Do not set priorities or judge whether the idea is good.
- The transcript is machine-made and may contain errors; do not guess at fixes.`;

const QUESTIONS_WANTED =
  "0, 1 or 2 short, optional, curious questions that would help them remember or develop the idea later (for example, what sparked it, or who it is for). Ask 0 if the idea is already clear.";
const QUESTIONS_NOT_WANTED = "always an empty list.";

export function enrichSystemPrompt(req: EnrichRequest) {
  return ENRICH_SYSTEM.replace("{Q}", req.wantQuestions ? QUESTIONS_WANTED : QUESTIONS_NOT_WANTED);
}

export function enrichUserMessage(req: EnrichRequest) {
  const parts = req.words.map((w, i) => {
    const label = w.kind === "capture" ? "Original capture" : w.kind === "answer" ? `Answer to "${w.question ?? ""}"` : "Added thought";
    return `<words index="${i + 1}" kind="${label}">\n${w.text}\n</words>`;
  });
  return `Here are my words for one idea, oldest first:\n\n${parts.join("\n\n")}`;
}

export const ENRICH_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    type: { type: "string", enum: [...IDEA_TYPES] },
    summary: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["title", "type", "summary", "questions"],
  additionalProperties: false,
} as const;

/** Validate and clamp model output. Never trust shape or length. */
export function normalizeEnrich(raw: unknown, provider: string, wantQuestions: boolean): EnrichResult {
  let obj = raw;
  if (typeof raw === "string") {
    const m = raw.match(/\{[\s\S]*\}/);
    obj = m ? JSON.parse(m[0]) : {};
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  const title = String(o.title ?? "").trim().slice(0, 120);
  const summary = String(o.summary ?? "").trim().slice(0, 600);
  const type: IdeaType = isIdeaType(o.type) ? o.type : "other";
  const questions = wantQuestions && Array.isArray(o.questions)
    ? o.questions.map((q) => String(q).trim()).filter(Boolean).slice(0, 2).map((q) => q.slice(0, 200))
    : [];
  if (!title && !summary) throw new Error("empty AI result");
  return { title: title || "Untitled idea", type, summary, questions, provider };
}
