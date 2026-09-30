import Anthropic from "@anthropic-ai/sdk";
import type { EnrichRequest } from "@xoba/shared";
import { ProviderError, type Enricher } from "./types.js";
import { ENRICH_JSON_SCHEMA, enrichSystemPrompt, enrichUserMessage, normalizeEnrich } from "./prompt.js";

/** USD per million tokens [input, output]. Override with ANTHROPIC_PRICE_IN / _OUT if you change model. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
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

export function anthropicEnricher(opts: AnthropicOptions): Enricher {
  const model = opts.model || "claude-opus-5";
  const [defIn, defOut] = PRICES[model] ?? [5, 25];
  const priceIn = opts.priceIn ?? defIn;
  const priceOut = opts.priceOut ?? defOut;
  const client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 60_000, fetch: opts.fetch }) : null;

  return {
    name: `anthropic:${model}`,
    unavailableReason: () => (client ? undefined : "ANTHROPIC_API_KEY is not set"),
    async enrich(req: EnrichRequest) {
      if (!client) throw new ProviderError("ANTHROPIC_API_KEY is not set", false);
      let response;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 2000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low", format: { type: "json_schema", schema: ENRICH_JSON_SCHEMA as never } },
          system: enrichSystemPrompt(req),
          messages: [{ role: "user", content: enrichUserMessage(req) }],
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.BadRequestError) {
          throw new ProviderError(`Anthropic: ${err.message}`, false);
        }
        if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic: ${err.message}`, true);
        throw new ProviderError(`Anthropic: ${(err as Error).message}`, true);
      }
      const costUsd =
        (response.usage.input_tokens * priceIn + response.usage.output_tokens * priceOut) / 1_000_000;
      if (response.stop_reason === "refusal") {
        throw Object.assign(new ProviderError("The AI declined to summarise this idea", false), { costUsd });
      }
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { result: normalizeEnrich(text, `anthropic:${response.model}`, req.wantQuestions), costUsd };
    },
  };
}
