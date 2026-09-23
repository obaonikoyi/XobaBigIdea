# Hosting options

The hosting decision can wait. The same app runs in these setups; pick one with
environment variables and nothing else changes. Your data moves between them
with Export → Restore.

| | Storage | Audio | Transcription | Cards (AI) | Cost |
|---|---|---|---|---|---|
| **A. Cloudflare free tier** | D1 | R2 | Workers AI Whisper | Workers AI (Llama) or Anthropic | $0 within free limits |
| **B. Node + SQLite** (one small VPS, or your own machine) | SQLite file | disk | OpenAI Whisper | Anthropic | server + API usage |
| **C. Node + Postgres** | Postgres (`DATABASE_URL`) | disk | OpenAI Whisper | Anthropic | server + DB + API usage |

## Providers

Every provider sits behind an interface in `server/src/providers/types.ts`:

- `IdeaStore`: `SqlIdeaStore` runs on SQLite (`node:sqlite`), Postgres (`pg`) and Cloudflare D1 using the same SQL.
- `BlobStore`: disk (`fsBlobStore`) or Cloudflare R2 (`r2BlobStore`). Audio is write-once.
- `Transcriber`: `TRANSCRIBE_PROVIDER=openai | workers-ai | fake | none`
- `Enricher`: `AI_PROVIDER=anthropic | workers-ai | fake | none`

To add a provider (for example S3 for audio, or another speech-to-text
service), implement the interface and add a case in `server/src/config.ts`.

To move the backend to **FastAPI**, implement the endpoints in
[API.md](API.md). The web app only speaks that contract, so it needs no changes.
Use a relative server URL, or set Settings → Server address.

## Spending cap

`AI_MONTHLY_CAP_USD` (default 5, and 0 turns AI off). Before each paid call the
server checks this month's recorded spend and refuses once it has reached the
cap. The check runs before the call, so the last call can go past the cap by at
most its own cost (about a cent). Costs are estimated from the provider's reported token usage or the audio length:

- Anthropic: priced per token for the configured model (`claude-opus-5` by default,
  $5 / $25 per million input/output tokens). A card costs roughly 1–2 cents.
  Override the model with `ANTHROPIC_MODEL`, and prices with `ANTHROPIC_PRICE_IN/OUT`.
  Requests opt in to Anthropic's server-side refusal fallback (`fallbacks: "default"`).
- OpenAI Whisper: $0.006 per audio minute. Files over 25 MB are not sent (the audio is still kept).
- Workers AI: rough estimates ($0.0005 per audio minute, $0.002 per card). The free
  tier is 10,000 neurons a day, and past that calls fail and the app waits.

## A. Cloudflare (free tier)

```bash
npm install && npm run build -w web
cd server
npx wrangler login
npx wrangler d1 create xoba-big-idea      # paste the id into wrangler.toml
npx wrangler r2 bucket create xoba-big-idea-audio
npx wrangler secret put APP_TOKEN
# optional, to use Claude for cards instead of Workers AI:
#   set AI_PROVIDER = "anthropic" in wrangler.toml and: npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Tables are created on the first request. Open the URL, go to Settings, and enter the app token.

## B/C. Node

```bash
npm install && npm run build -w web
cp server/.env.example server/.env    # set APP_TOKEN, keys, cap; DATABASE_URL for Postgres
set -a; . server/.env; set +a
npm start
```

Put it behind HTTPS (Caddy, nginx or a tunnel), because browsers only allow the
microphone on HTTPS. Back up `DATA_DIR` (or the Postgres database plus `DATA_DIR/audio`),
and keep exporting from the app too.
