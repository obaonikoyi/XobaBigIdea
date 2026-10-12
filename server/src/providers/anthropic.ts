import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, EnrichRequest, TakeRequest } from "@xoba/shared";
import { ProviderError, type Enricher } from "./types.js";
import {
  ENRICH_JSON_SCHEMA,
  TAKE_JSON_SCHEMA,
  TAKE_SYSTEM,
  chatSystemPrompt,
  enrichSystemPrompt,
  enrichUserMessage,
  normalizeEnrich,
  normalizeTake,
  takeUserMessage,
} from "./prompt.js";

/** USD per million tokens [input, output]. Override with ANTHROPIC_PRICE_IN / _OUT if you change model. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  priceIn?: number;
  priceOut?: number;
  /** For tests only. */
  fetch?: typeof fetch;
}

type Effort = "low" | "medium" | "high";

export function anthropicEnricher(opts: AnthropicOptions): Enricher {
  const model = opts.model || "claude-opus-5-5";
  const [defIn, defOut] = PRICES[model] ?? [4, 20];
  const priceIn = opts.priceIn ?? defIn;
  const priceOut = opts.priceOut ?? defOut;
  const client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 120_000, fetch: opts.fetch }) : null;

  /** One request. Returns the reply text and what it cost; maps SDK errors to ProviderError. */
  async function run(what: string, effort: Effort, system: string, messages: Anthropic.Beta.BetaMessageParam[], schema?: object) {
    if (!client) throw new ProviderError("ANTHROPIC_API_KEY is not set", false);
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort, ...(schema ? { format: { type: "json_schema", schema: schema as never } } : {}) },
        system,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.BadRequestError) {
        throw new ProviderError(`Anthropic: ${err.message}`, false);
      }
      if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic: ${err.message}`, true);
      throw new ProviderError(`Anthropic: ${(err as Error).message}`, true);
    }
    const costUsd = (response.usage.input_tokens * priceIn + response.usage.output_tokens * priceOut) / 1_000_000;
    if (response.stop_reason === "refusal") {
      throw Object.assign(new ProviderError(`The AI declined to ${what}`, false), { costUsd });
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, costUsd, provider: `anthropic:${response.model}` };
  }

  /** Bad model output is not worth retrying automatically, but its cost still counts. */
  function parsed<T>(costUsd: number, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw Object.assign(new ProviderError(`Anthropic: ${(err as Error).message}`, false), { costUsd });
    }
  }

  return {
    name: `anthropic:${model}`,
    unavailableReason: () => (client ? undefined : "ANTHROPIC_API_KEY is not set"),

    async enrich(req: EnrichRequest) {
      const r = await run("summarise this idea", "low", enrichSystemPrompt(req), [{ role: "user", content: enrichUserMessage(req) }], ENRICH_JSON_SCHEMA);
      return { result: parsed(r.costUsd, () => normalizeEnrich(r.text, r.provider, req.wantQuestions)), costUsd: r.costUsd };
    },

    async take(req: TakeRequest) {
      const r = await run("give a take on this idea", "medium", TAKE_SYSTEM, [{ role: "user", content: takeUserMessage(req) }], TAKE_JSON_SCHEMA);
      return { result: { ...parsed(r.costUsd, () => normalizeTake(r.text)), provider: r.provider }, costUsd: r.costUsd };
    },

    async chat(req: ChatRequest) {
      const messages = req.messages.map((m): Anthropic.Beta.BetaMessageParam => ({ role: m.role === "me" ? "user" : "assistant", content: m.text }));
      const r = await run("reply", "medium", chatSystemPrompt(req), messages);
      const reply = r.text.trim();
      if (!reply) throw Object.assign(new ProviderError("Anthropic: empty reply", true), { costUsd: r.costUsd });
      return { result: { reply, provider: r.provider }, costUsd: r.costUsd };
    },
  };
}
