import type { Enricher, Transcriber } from "./providers/types.js";
import { anthropicEnricher } from "./providers/anthropic.js";
import { openaiTranscriber } from "./providers/openai-transcribe.js";
import { fakeEnricher, fakeTranscriber, noEnricher, noTranscriber } from "./providers/offline.js";
import { workersAiEnricher, workersAiTranscriber } from "./providers/workers-ai.js";
import type { Ai } from "@cloudflare/workers-types";

export type Env = Record<string, string | undefined>;

const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));

/** Pick the AI provider from AI_PROVIDER = anthropic | workers-ai | fake | none. */
export function pickEnricher(env: Env, ai?: Ai): Enricher {
  switch ((env.AI_PROVIDER || "none").toLowerCase()) {
    case "anthropic":
      return anthropicEnricher({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, priceIn: num(env.ANTHROPIC_PRICE_IN), priceOut: num(env.ANTHROPIC_PRICE_OUT) });
    case "workers-ai":
      return workersAiEnricher(ai, env.WORKERS_AI_MODEL || undefined);
    case "fake":
      return fakeEnricher();
    default:
      return noEnricher();
  }
}

/** Pick transcription from TRANSCRIBE_PROVIDER = openai | workers-ai | fake | none. */
export function pickTranscriber(env: Env, ai?: Ai): Transcriber {
  switch ((env.TRANSCRIBE_PROVIDER || "none").toLowerCase()) {
    case "openai":
      return openaiTranscriber({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_TRANSCRIBE_MODEL, pricePerMin: num(env.OPENAI_TRANSCRIBE_PRICE_PER_MIN), baseUrl: env.OPENAI_BASE_URL });
    case "workers-ai":
      return workersAiTranscriber(ai);
    case "fake":
      return fakeTranscriber();
    default:
      return noTranscriber();
  }
}

export function capUsd(env: Env) {
  return num(env.AI_MONTHLY_CAP_USD) ?? 5;
}
