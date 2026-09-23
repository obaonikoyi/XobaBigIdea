// Everything that changes an idea goes through here. Each change is saved to
// IndexedDB immediately and queued for sync.
import type { EnrichResult, Entry, FollowUp, Idea, IdeaStatus, IdeaType, Priority } from "@xoba/shared";
import * as db from "./db";
import { emitChange } from "./events";

export const newId = () => crypto.randomUUID().replace(/-/g, "");

/** Clock is injectable for tests. */
export let now = () => new Date();
export function setClock(fn: () => Date) {
  now = fn;
}

/** Guarantees updatedAt always moves forward, even if two edits land in the same millisecond. */
function bump(prev?: string) {
  let t = now().toISOString();
  if (prev && t <= prev) t = new Date(new Date(prev).getTime() + 1).toISOString();
  return t;
}

async function save(idea: Idea) {
  await db.putIdea(idea);
  emitChange();
  return idea;
}

async function update(id: string, fn: (idea: Idea) => void) {
  const idea = await db.getIdea(id);
  if (!idea) throw new Error(`idea ${id} not found`);
  fn(idea);
  idea.updatedAt = bump(idea.updatedAt);
  return save(idea);
}

export interface CaptureInput {
  text: string;
  audio?: { id: string; mime: string; durationMs: number };
  /** When the capture started (recording start). Defaults to now. */
  at?: Date;
}

function makeEntry(kind: Entry["kind"], input: CaptureInput, question?: string): Entry {
  return {
    id: newId(),
    createdAt: (input.at ?? now()).toISOString(),
    kind,
    text: input.text,
    question,
    audioId: input.audio?.id,
    audioMime: input.audio?.mime,
    audioDurationMs: input.audio?.durationMs,
    transcriptStatus: input.audio ? "pending" : "none",
  };
}

/** Save a brand-new idea. No AI involved; this completes before anything else runs. */
export async function createIdea(input: CaptureInput, id = newId()): Promise<Idea> {
  const at = input.at ?? now();
  const idea: Idea = {
    id,
    createdAt: at.toISOString(),
    tzOffsetMin: -at.getTimezoneOffset(),
    updatedAt: bump(),
    status: "captured",
    priority: null,
    title: { value: "", source: "ai" },
    type: { value: "other", source: "ai" },
    summary: { value: "", source: "ai" },
    entries: [makeEntry("capture", input)],
    followUps: [],
  };
  return save(idea);
}

/** Add a thought (text and/or voice) to an existing idea. */
export function addThought(ideaId: string, input: CaptureInput) {
  return update(ideaId, (i) => void i.entries.push(makeEntry("thought", input)));
}

export function setField(ideaId: string, field: "title" | "summary", value: string) {
  return update(ideaId, (i) => void (i[field] = { value, source: "me" }));
}

export function setType(ideaId: string, value: IdeaType) {
  return update(ideaId, (i) => void (i.type = { value, source: "me" }));
}

export function setStatus(ideaId: string, status: IdeaStatus) {
  return update(ideaId, (i) => void (i.status = status));
}

export function setPriority(ideaId: string, priority: Priority) {
  return update(ideaId, (i) => void (i.priority = priority));
}

export function editTranscript(ideaId: string, entryId: string, transcript: string) {
  return update(ideaId, (i) => {
    const e = i.entries.find((x) => x.id === entryId);
    if (e) Object.assign(e, { transcript, transcriptStatus: "done", transcriptEditedByMe: true });
  });
}

export function retryTranscript(ideaId: string, entryId: string) {
  return update(ideaId, (i) => {
    const e = i.entries.find((x) => x.id === entryId);
    if (e && e.audioId) e.transcriptStatus = "pending";
  });
}

export function setTranscript(ideaId: string, entryId: string, transcript: string, status: Entry["transcriptStatus"]) {
  return update(ideaId, (i) => {
    const e = i.entries.find((x) => x.id === entryId);
    // Never overwrite a transcript the user corrected by hand.
    if (e && !e.transcriptEditedByMe) Object.assign(e, { transcript, transcriptStatus: status });
  });
}

/** AI suggestions only fill fields the user has not written themselves. Original words are untouched. */
export function applyEnrichment(ideaId: string, r: EnrichResult, basedOnEntries: number) {
  return update(ideaId, (i) => {
    if (i.title.source === "ai") i.title = { value: r.title, source: "ai" };
    if (i.type.source === "ai") i.type = { value: r.type, source: "ai" };
    if (i.summary.source === "ai") i.summary = { value: r.summary, source: "ai" };
    if (i.followUps.length === 0) {
      i.followUps = r.questions.slice(0, 2).map((q): FollowUp => ({ id: newId(), question: q, state: "open" }));
    }
    i.ai = { generatedAt: now().toISOString(), provider: r.provider, basedOnEntries };
  });
}

export function answerFollowUp(ideaId: string, followUpId: string, answer: CaptureInput) {
  return update(ideaId, (i) => {
    const f = i.followUps.find((x) => x.id === followUpId);
    if (!f) return;
    f.state = "answered";
    i.entries.push(makeEntry("answer", answer, f.question));
  });
}

export function leaveFollowUpForLater(ideaId: string, followUpId?: string) {
  return update(ideaId, (i) => {
    for (const f of i.followUps) if (f.state === "open" && (!followUpId || f.id === followUpId)) f.state = "later";
  });
}

export function markReviewed(ids: string[], status?: IdeaStatus) {
  return Promise.all(
    ids.map((id) =>
      update(id, (i) => {
        i.lastReviewedAt = now().toISOString();
        if (status) i.status = status;
      }),
    ),
  );
}

/** Display title: the card title, or the first words the user said. */
export function displayTitle(idea: Idea) {
  if (idea.title.value.trim()) return idea.title.value;
  const first = idea.entries.find((e) => e.text.trim() || e.transcript?.trim());
  const words = (first?.text.trim() || first?.transcript?.trim() || "").split(/\s+/).slice(0, 8).join(" ");
  if (words) return words;
  return idea.entries[0]?.audioId ? "Voice note" : "Untitled idea";
}
