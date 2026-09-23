# Xoba Big Idea

**Speak it. Save it. Come back to it.**

A personal app for capturing ideas, and only ideas. Tap the big mic or type,
and the idea is saved on your device at once, before any AI runs. Later, AI
turns it into an editable card. Your own words and recordings are kept exactly
as they are, permanently.

This project is separate from xobametrics. It imports nothing from it and does not change it.

## What v1 does

- **Capture**: one big mic button and a text box. The idea is saved to the
  browser (IndexedDB) immediately with the device's date and time. Audio is
  written every second while you record, so closing the app mid-song loses at
  most about a second, and the recording is recovered next time you open it.
- **Local-first and offline**: the app shell is cached by a service worker.
  Capture, browsing and replay all work with no connection. Changes sync to the
  server when it can be reached.
- **Originals kept**: the audio is never replaced or re-encoded. Transcription
  happens afterwards and is shown separately, labelled as automatic. The AI is told
  never to rewrite, correct or translate lyrics, Pidgin or Yoruba, and it has no
  way to edit your words: it only fills card fields.
- **Idea card**: title, type and summary, each tagged *AI suggestion* or
  *Yours*. Once you edit a field the AI never touches it again. Priority stays
  **Not set** until you choose one. Your words are listed underneath with the date, audio and transcript.
- **Follow-up questions**: after saving, at most 2 optional questions, always with
  **Leave for later**. Answers (typed or spoken) are stored as your words.
- **Library**: search (accent-insensitive, so Yoruba tone marks don't get in
  the way), category filters, and the statuses Captured / Later / Chosen / Archived.
  You can replay audio and add a thought (typed or spoken) to any idea.
- **Weekly review**: shows 3 waiting ideas. The choices are *Develop this one*,
  *Keep them for later* and *Continue my current project*, and each one gets a
  "Good choice". There are no notifications.
- **Export and restore**: Settings → Export produces one `.zip` with
  `ideas.json` (for restoring), `ideas.md` (readable text) and `audio/` (every
  original recording). Restore merges: it adds what's missing, keeps the newest
  version of each idea, and never deletes anything.
- **AI spending cap**: a monthly USD cap, enforced on the server. When AI is
  down, unconfigured or over the cap, everything else keeps working, and cards
  and transcripts catch up later.
- **Swappable providers**: storage, transcription and AI are each behind an
  interface. See [docs/HOSTING.md](docs/HOSTING.md).

Not in v1: subscriptions, teams, sharing, project management, generating songs
or apps, notifications.

## Run it locally

Needs Node 22+.

```bash
npm install
npm run build                      # builds the web app
cp server/.env.example server/.env # edit keys, or leave AI as "none"
set -a; . server/.env; set +a
npm start                          # http://localhost:8787 (serves app + API)
```

To try it without any API keys, run with fake AI:
`AI_PROVIDER=fake TRANSCRIBE_PROVIDER=fake npm start`.

To work on the code, run `npm run dev -w server` and `npm run dev -w web`, then open
http://localhost:5173 (Vite proxies `/api` to port 8787).

Microphone access needs HTTPS or `localhost`. To use it on your phone, deploy it
(see hosting) or put it behind an HTTPS tunnel.

## Tests

```bash
npm test                   # server + web unit/integration tests
npm run typecheck
npm run e2e -w web         # real Chromium with a fake microphone
PG_TEST_URL=postgres://... npm test -w server   # also tests the Postgres store
```

The end-to-end suite covers the "done when" list: voice and text capture that
survives reopening, recovery of an interrupted recording, the editable card
next to your original words, finding, replaying and adding to an old idea,
export then restore into an empty app (audio included), capturing offline,
and capturing and replaying with AI switched off.

If Playwright's bundled browser isn't installed, set
`CHROMIUM_PATH=/path/to/chrome`, or run `npx playwright install chromium`.

## Layout

```
shared/   types shared by app and server: the data contract
web/      React PWA (Vite). src/lib has the logic, src/screens the UI
server/   Hono API. src/node.ts (Node) and src/worker.ts (Cloudflare) entry points
          src/providers: storage (SQLite, Postgres, D1, disk, R2) and AI (Anthropic, OpenAI, Workers AI)
docs/     API contract and hosting options
```

## Next step

Use it for 10 real ideas before adding anything.
