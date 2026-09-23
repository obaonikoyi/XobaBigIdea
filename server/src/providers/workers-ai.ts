import type { Ai } from "@cloudflare/workers-types";
import type { EnrichRequest } from "@xoba/shared";
import { ProviderError, type Enricher, type Transcriber } from "./types.js";
import { ENRICH_JSON_SCHEMA, enrichSystemPrompt, enrichUserMessage, normalizeEnrich } from "./prompt.js";

// Workers AI bills in neurons at USD 0.011 per 1,000 with 10,000 free per day.
// These are rough per-call estimates so the spending cap still means something.
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
const WHISPER_USD_PER_MIN = 0.0005;
const DEFAULT_LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const LLM_USD_PER_CALL = 0.002;

function toBase64(bytes: Uint8Array) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function workersAiTranscriber(ai: Ai | undefined): Transcriber {
  return {
    name: `workers-ai:${WHISPER_MODEL}`,
    unavailableReason: () => (ai ? undefined : "Workers AI binding (AI) is missing"),
    async transcribe(audio, _mime, durationMs) {
      if (!ai) throw new ProviderError("Workers AI binding missing", false);
      try {
        const out = (await ai.run(WHISPER_MODEL as never, { audio: toBase64(audio) } as never)) as { text?: string };
        return {
          result: { text: out.text ?? "", provider: `workers-ai:${WHISPER_MODEL}` },
          costUsd: (Math.max(durationMs, 1000) / 60_000) * WHISPER_USD_PER_MIN,
        };
      } catch (err) {
        throw new ProviderError(`Workers AI transcription failed: ${(err as Error).message}`);
      }
    },
  };
}

export function workersAiEnricher(ai: Ai | undefined, model = DEFAULT_LLM): Enricher {
  return {
    name: `workers-ai:${model}`,
    unavailableReason: () => (ai ? undefined : "Workers AI binding (AI) is missing"),
    async enrich(req: EnrichRequest) {
      if (!ai) throw new ProviderError("Workers AI binding missing", false);
      try {
        const out = (await ai.run(model as never, {
          messages: [
            { role: "system", content: enrichSystemPrompt(req) + "\nReply with JSON only." },
            { role: "user", content: enrichUserMessage(req) },
          ],
          response_format: { type: "json_schema", json_schema: ENRICH_JSON_SCHEMA },
          max_tokens: 600,
        } as never)) as { response?: unknown };
        return { result: normalizeEnrich(out.response, `workers-ai:${model}`, req.wantQuestions), costUsd: LLM_USD_PER_CALL };
      } catch (err) {
        throw new ProviderError(`Workers AI enrich failed: ${(err as Error).message}`);
      }
    },
  };
}
