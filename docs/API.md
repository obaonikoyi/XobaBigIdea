# Backend API contract (v1)

The web app talks only to these endpoints, and the types are in `shared/index.ts`.
Any backend that implements them works, whether the bundled Node or Cloudflare
server or a FastAPI port.

All `/api/*` routes except `/api/ping` require `Authorization: Bearer <APP_TOKEN>`
when a token is configured. Errors are JSON: `{ "error": code, "message": text }`.

| Method & path | Body | Response |
|---|---|---|
| `GET /api/ping` | | `{ ok: true }` (no auth) |
| `GET /api/health` | | `HealthResponse`: storage name, `ai` status (availability, reason, month spend, cap), `serverTime` |
| `GET /api/ideas?since=<serverTime>` | | `{ ideas: Idea[], serverTime }`. Ideas stored at or after `since` (server clock). The client keeps `serverTime` as its next cursor. |
| `GET /api/ideas/:id` | | `Idea` or 404 |
| `PUT /api/ideas/:id` | `Idea` JSON | The stored `Idea`. **Last write wins by `updatedAt`**: an older copy never replaces a newer one. The server stamps its own sync time. |
| `PUT /api/audio/:id` | raw bytes, `Content-Type` = audio mime | `{ ok, id, bytes }`. **Write-once**: if the id exists, it is not replaced. |
| `HEAD /api/audio/:id` | | 200 or 404 |
| `GET /api/audio/:id` | | the original bytes with their mime type |
| `POST /api/transcribe/:audioId?durationMs=` | | `{ text, provider }`, verbatim from the speech-to-text provider |
| `POST /api/enrich` | `{ words: [{kind, text, question?}], wantQuestions }` | `{ title, type, summary, questions (≤2), provider }` |

AI endpoints return:

- `402 over_cap` when the monthly cap is reached, or when the cap is 0
- `503 ai_unavailable` when no provider is configured, and `503 provider_error` for a temporary failure (the client retries later)
- `422 provider_error` when this input can't be processed (the client stops retrying it)

IDs match `^[A-Za-z0-9_-]{1,64}$`.

## Storage schema

```sql
ideas    (id TEXT PRIMARY KEY, updated_at TEXT, synced_at TEXT, data TEXT /* Idea JSON */)
ai_usage (id TEXT PRIMARY KEY, at TEXT, month TEXT /* YYYY-MM */, kind TEXT, provider TEXT, cost_usd DOUBLE PRECISION)
```
