import type { EnrichRequest, EnrichResult, Idea, TranscribeResult } from "@xoba/shared";

/** Where idea records live (SQLite, Postgres, Cloudflare D1, ...). */
export interface IdeaStore {
  readonly name: string;
  init(): Promise<void>;
  /** Last-write-wins upsert. Returns the record now stored (which may be the existing newer one). */
  putIdea(idea: Idea, serverTime: string): Promise<Idea>;
  getIdea(id: string): Promise<Idea | null>;
  /** Ideas changed on the server at or after `since` (server time). */
  listIdeas(since?: string): Promise<{ idea: Idea; syncedAt: string }[]>;
  /** Spending ledger for the AI cap. */
  recordUsage(u: UsageRecord): Promise<void>;
  monthSpendUsd(month: string): Promise<number>;
}

export interface UsageRecord {
  id: string;
  at: string;
  month: string; // YYYY-MM
  kind: "enrich" | "transcribe";
  provider: string;
  costUsd: number;
}

/** Where audio files live (local disk, Cloudflare R2, ...). Originals are kept forever. */
export interface BlobStore {
  readonly name: string;
  put(id: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(id: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  has(id: string): Promise<boolean>;
}

export interface ProviderResult<T> {
  result: T;
  costUsd: number;
}

/** Speech to text. Must return the words as heard: no cleanup, no translation. */
export interface Transcriber {
  readonly name: string;
  /** Returns a reason string if the provider cannot run (e.g. missing key). */
  unavailableReason(): string | undefined;
  transcribe(audio: Uint8Array, mime: string, durationMs: number): Promise<ProviderResult<TranscribeResult>>;
}

/** Turns the user's words into card suggestions. Never rewrites the words themselves. */
export interface Enricher {
  readonly name: string;
  unavailableReason(): string | undefined;
  enrich(req: EnrichRequest): Promise<ProviderResult<EnrichResult>>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
  }
}
