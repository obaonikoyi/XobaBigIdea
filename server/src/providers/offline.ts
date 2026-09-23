import type { EnrichRequest } from "@xoba/shared";
import { ProviderError, type Enricher, type Transcriber } from "./types.js";

/** Used when no provider is configured. The app keeps working without AI. */
export function noEnricher(reason = "No AI provider configured"): Enricher {
  return {
    name: "none",
    unavailableReason: () => reason,
    async enrich() {
      throw new ProviderError(reason, false);
    },
  };
}

export function noTranscriber(reason = "No transcription provider configured"): Transcriber {
  return {
    name: "none",
    unavailableReason: () => reason,
    async transcribe() {
      throw new ProviderError(reason, false);
    },
  };
}

/**
 * Deterministic fake for local development and tests (AI_PROVIDER=fake).
 * Costs a pretend USD 0.01 per call so the spending cap can be exercised.
 */
export function fakeEnricher(): Enricher {
  return {
    name: "fake",
    unavailableReason: () => undefined,
    async enrich(req: EnrichRequest) {
      const all = req.words.map((w) => w.text).join(" ").trim();
      const firstWords = all.split(/\s+/).slice(0, 6).join(" ");
      const looksLikeSong = /\b(song|verse|chorus|hook|lyric|beat|melody)\b/i.test(all);
      return {
        result: {
          title: firstWords || "Untitled idea",
          type: looksLikeSong ? "song" : "other",
          summary: all ? `An idea about: ${all.slice(0, 80)}` : "A voice note.",
          questions: req.wantQuestions ? ["What sparked this idea?"] : [],
          provider: "fake",
        },
        costUsd: 0.01,
      };
    },
  };
}

export function fakeTranscriber(): Transcriber {
  return {
    name: "fake",
    unavailableReason: () => undefined,
    async transcribe(audio) {
      return { result: { text: `(fake transcript of ${audio.byteLength} bytes)`, provider: "fake" }, costUsd: 0.001 };
    },
  };
}
