import { IDEA_TYPES, isIdeaType, type ChatRequest, type EnrichRequest, type EnrichResult, type IdeaType, type TakeContent, type TakeRequest } from "@xoba/shared";

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

// ---------------------------------------------------------------------------
// AI take and chat

const ABOUT_THEM = `You are a sharp, honest thinking partner for one person who keeps a private notebook of ideas: songs, businesses, apps, stories, projects. They capture ideas quickly by voice or text, often mixing English, Nigerian Pidgin and Yoruba, and they come back to you to understand what they have and whether it is worth their time.`;

const THEIR_WORDS = `Their words are theirs. When you quote them, quote exactly, including Pidgin and Yoruba, and do not translate or "correct" them. Transcripts are machine-made and may contain errors; if something looks garbled, work with the most likely meaning without dwelling on it.`;

export const TAKE_SYSTEM = `${ABOUT_THEM}

Read everything they have said about this idea and give your take:
- whatYouMean: 2-4 sentences restating the core of the idea in plain English, so they can see you understood it. Be concrete: who it is for, what it does or says, what makes it different. If part of it is unclear, say what is unclear instead of inventing details.
- strengths: 2-4 specific things that are genuinely promising. Point at their actual words or details, not generic praise.
- risks: 2-4 honest gaps, risks or open questions: the things most likely to stop this working.
- opinion: your straight view in 2-4 sentences. Is it worth pursuing now, worth developing a bit more first, or better parked? Say why. Commit to a view; they would rather hear a clear opinion they can disagree with than a vague one.
- nextSteps: 2-4 small, concrete actions they could take this week to move it forward or test it cheaply. Start each with a verb.

Write like a smart friend who knows the field: plain words, short sentences, no filler, no flattery, no buzzwords. Each list item is one or two sentences.

${THEIR_WORDS} For songs, react to the hook, theme, feel and audience; do not write lyrics or verses for them. Do not write code, full business plans or finished pieces of work.`;

export const CHAT_SYSTEM = `${ABOUT_THEM}

They want to talk one idea through with you. The idea, in their own words, and your earlier take on it are below.

Reply like a smart friend who knows the field. Be direct: give real opinions, push back when something will not work, and ask one sharp question when it would genuinely help. Keep replies short by default, a few short paragraphs or a short list, unless they ask you to go deeper. Plain words, no filler, no flattery. Write plain text that reads well on a phone: no markdown headings, bold or tables; simple lists starting with "- " are fine. Reply in English unless they write to you in another language.

${THEIR_WORDS} Help them think rather than doing the making for them: do not write whole songs, full lyrics, apps or complete business plans. Brief examples are fine when they ask for them, and only suggest new wording for their lyrics if they ask.`;

export const TAKE_JSON_SCHEMA = {
  type: "object",
  properties: {
    whatYouMean: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    opinion: { type: "string" },
    nextSteps: { type: "array", items: { type: "string" } },
  },
  required: ["whatYouMean", "strengths", "risks", "opinion", "nextSteps"],
  additionalProperties: false,
} as const;

function ideaContext(req: { words: TakeRequest["words"]; title?: string; type?: string }) {
  const head = [req.title ? `Title: ${req.title}` : "", req.type ? `Type: ${req.type}` : ""].filter(Boolean).join("\n");
  return [head, enrichUserMessage({ words: req.words, wantQuestions: false })].filter(Boolean).join("\n\n");
}

export function takeUserMessage(req: TakeRequest) {
  let msg = ideaContext(req);
  if (req.chat?.length) {
    const lines = req.chat.map((m) => `${m.role === "me" ? "Me" : "You"}: ${m.text}`).join("\n\n");
    msg += `\n\nWe have also talked it through. Treat what I said here as part of the idea:\n<conversation>\n${lines}\n</conversation>`;
  }
  return msg;
}

export function takeText(t: TakeContent) {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return `What you mean: ${t.whatYouMean}\nStrengths:\n${list(t.strengths)}\nRisks:\n${list(t.risks)}\nOpinion: ${t.opinion}\nNext steps:\n${list(t.nextSteps)}`;
}

export function chatSystemPrompt(req: ChatRequest) {
  let s = `${CHAT_SYSTEM}\n\n<idea>\n${ideaContext(req)}\n</idea>`;
  if (req.take) s += `\n\n<your_earlier_take>\n${takeText(req.take)}\n</your_earlier_take>`;
  return s;
}

/** Validate and clamp a take. Never trust shape or length. */
export function normalizeTake(raw: unknown): TakeContent {
  let obj = raw;
  if (typeof raw === "string") {
    const m = raw.match(/\{[\s\S]*\}/);
    obj = m ? JSON.parse(m[0]) : {};
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 600)).filter(Boolean).slice(0, 6) : []);
  const take = {
    whatYouMean: str(o.whatYouMean, 1500),
    strengths: list(o.strengths),
    risks: list(o.risks),
    opinion: str(o.opinion, 1500),
    nextSteps: list(o.nextSteps),
  };
  if (!take.whatYouMean && !take.opinion) throw new Error("empty AI take");
  return take;
}
