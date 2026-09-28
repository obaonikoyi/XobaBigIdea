import { ProviderError, type Transcriber } from "./types.js";

/**
 * OpenAI Whisper over HTTP. A language hint stops Whisper guessing the wrong
 * language for a Nigerian accent. For English we also send a short vocabulary
 * hint so Pidgin words are spelled the way people write them. Neither changes
 * or tidies the words; the result is still what was heard.
 * Priced at USD 0.006 per audio minute (override with OPENAI_TRANSCRIBE_PRICE_PER_MIN).
 */
export const PIDGIN_HINT = "Nigerian English and Pidgin, e.g. wetin, abeg, oya, dey, na so, wahala, sabi, omo.";

export function openaiTranscriber(opts: { apiKey?: string; model?: string; pricePerMin?: number; baseUrl?: string }): Transcriber {
  const model = opts.model || "whisper-1";
  const pricePerMin = opts.pricePerMin ?? 0.006;
  return {
    name: `openai:${model}`,
    unavailableReason: () => (opts.apiKey ? undefined : "OPENAI_API_KEY is not set"),
    async transcribe(audio, mime, durationMs, language) {
      if (!opts.apiKey) throw new ProviderError("OPENAI_API_KEY is not set", false);
      if (audio.byteLength > 25 * 1024 * 1024) {
        throw new ProviderError("Recording is over 25 MB, too long for this transcription provider. The audio is kept.", false);
      }
      const ext = mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : mime.includes("mpeg") ? "mp3" : "webm";
      const form = new FormData();
      form.append("file", new Blob([audio as Uint8Array<ArrayBuffer>], { type: mime }), `audio.${ext}`);
      form.append("model", model);
      form.append("response_format", "json");
      if (language) form.append("language", language);
      if (language === "en") form.append("prompt", PIDGIN_HINT);
      const res = await fetch(`${opts.baseUrl ?? "https://api.openai.com/v1"}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(`OpenAI transcription failed (${res.status}): ${body.slice(0, 200)}`, res.status >= 500 || res.status === 429);
      }
      const data = (await res.json()) as { text?: string };
      return {
        result: { text: data.text ?? "", provider: `openai:${model}` },
        costUsd: (Math.max(durationMs, 1000) / 60_000) * pricePerMin,
      };
    },
  };
}
