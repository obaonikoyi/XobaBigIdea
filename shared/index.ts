// Types and small pure helpers shared by the web app and the server.
// This is the contract: any backend (Node, Cloudflare, or a future FastAPI port)
// must speak these shapes. See docs/API.md.

export const IDEA_TYPES = ["song", "business", "app", "writing", "project", "other"] as const;
export type IdeaType = (typeof IDEA_TYPES)[number];

export const IDEA_TYPE_LABELS: Record<IdeaType, string> = {
  song: "Song",
  business: "Business",
  app: "App / Tech",
  writing: "Writing",
  project: "Project",
  other: "Other",
};

export const STATUSES = ["captured", "later", "chosen", "archived"] as const;
export type IdeaStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  captured: "Captured",
  later: "Later",
  chosen: "Chosen",
  archived: "Archived",
};

/** null means "Not set". The app never sets priority on its own. */
export type Priority = null | "low" | "medium" | "high";

/** Who last wrote a card field. AI may only overwrite fields it wrote. */
export type FieldSource = "ai" | "me";

export interface CardField<T> {
  value: T;
  source: FieldSource;
}

export type TranscriptStatus = "none" | "pending" | "done" | "unavailable" | "failed";

/**
 * One thing the user said or typed. The first entry is the original capture;
 * later entries are thoughts added afterwards or answers to follow-up questions.
 * `text` and the audio are the user's own words and are never rewritten by AI.
 */
export interface Entry {
  id: string;
  /** ISO time recorded by the app (device clock) at the moment of capture. */
  createdAt: string;
  kind: "capture" | "thought" | "answer";
  /** Typed words, exactly as typed. */
  text: string;
  /** Present for answers: the question being answered. */
  question?: string;
  audioId?: string;
  audioMime?: string;
  audioDurationMs?: number;
  /** Machine transcript of the audio. Verbatim from the transcription provider, never AI-edited. */
  transcript?: string;
  transcriptStatus: TranscriptStatus;
  /** True if the user corrected the transcript by hand. */
  transcriptEditedByMe?: boolean;
}

export interface FollowUp {
  id: string;
  question: string;
  state: "open" | "answered" | "later";
}

export interface AiInfo {
  /** When suggestions were last generated. */
  generatedAt: string;
  provider: string;
  /** Number of entries the last suggestion was based on. */
  basedOnEntries: number;
}

export interface Idea {
  id: string;
  createdAt: string;
  /** Local timezone offset in minutes at capture time (e.g. 60 for UTC+1). */
  tzOffsetMin: number;
  updatedAt: string;
  status: IdeaStatus;
  priority: Priority;
  title: CardField<string>;
  type: CardField<IdeaType>;
  summary: CardField<string>;
  entries: Entry[];
  followUps: FollowUp[];
  ai?: AiInfo;
  lastReviewedAt?: string;
}

export interface EnrichRequest {
  /** The user's words, oldest first. */
  words: { kind: Entry["kind"]; text: string; question?: string }[];
  /** Whether to generate follow-up questions (only on first enrichment). */
  wantQuestions: boolean;
}

export interface EnrichResult {
  title: string;
  type: IdeaType;
  summary: string;
  questions: string[];
  provider: string;
}

export interface TranscribeResult {
  text: string;
  provider: string;
}

export interface AiStatus {
  enrich: { available: boolean; provider: string; reason?: string };
  transcribe: { available: boolean; provider: string; reason?: string };
  spend: { monthUsd: number; capUsd: number; overCap: boolean };
}

export interface HealthResponse {
  ok: true;
  storage: string;
  ai: AiStatus;
  serverTime: string;
}

export interface ApiError {
  error: "unauthorized" | "not_found" | "bad_request" | "ai_unavailable" | "over_cap" | "provider_error";
  message: string;
}

/** Combined words for an idea, for search and for AI input. */
export function ideaWords(idea: Idea): string {
  return idea.entries
    .map((e) => [e.text, e.transcript].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n");
}

/** Last-write-wins merge helper. Returns the idea that should be kept. */
export function newerIdea(a: Idea, b: Idea): Idea {
  return a.updatedAt >= b.updatedAt ? a : b;
}

export function isIdeaType(v: unknown): v is IdeaType {
  return typeof v === "string" && (IDEA_TYPES as readonly string[]).includes(v);
}

export function isValidIdea(v: unknown): v is Idea {
  if (!v || typeof v !== "object") return false;
  const i = v as Idea;
  return (
    typeof i.id === "string" &&
    i.id.length > 0 &&
    i.id.length <= 64 &&
    typeof i.createdAt === "string" &&
    typeof i.updatedAt === "string" &&
    (STATUSES as readonly string[]).includes(i.status) &&
    Array.isArray(i.entries) &&
    !!i.title &&
    !!i.type &&
    !!i.summary
  );
}
