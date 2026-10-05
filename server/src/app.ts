import { Hono } from "hono";
import { cors } from "hono/cors";
import { isValidIdea, type AiStatus, type ApiError, type EnrichRequest, type HealthResponse } from "@xoba/shared";
import { SAFE_ID } from "./providers/blobs.js";
import { ProviderError, type BlobStore, type Enricher, type IdeaStore, type Transcriber } from "./providers/types.js";
import { describeDevice, FailureLimiter, newSessionToken, secretsMatch, sha256Hex } from "./auth.js";

export interface AppDeps {
  store: IdeaStore;
  blobs: BlobStore;
  enricher: Enricher;
  transcriber: Transcriber;
  /** Monthly AI spending cap in USD. 0 turns AI off. */
  capUsd: number;
  /** Password for signing in on a device. Each sign-in gets its own session token. */
  appPassword?: string;
  /** Optional fixed token (for scripts or older setups). Also accepted as a bearer token. */
  appToken?: string;
  corsOrigin?: string;
  now?: () => Date;
}

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_IDEA_BYTES = 2 * 1024 * 1024;

function err(error: ApiError["error"], message: string): ApiError {
  return { error, message };
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const month = () => now().toISOString().slice(0, 7);
  const app = new Hono();

  if (deps.corsOrigin) {
    app.use("/api/*", cors({ origin: deps.corsOrigin, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "PUT", "POST"] }));
  }

  app.get("/api/ping", (c) => c.json({ ok: true }));

  // ---- Sign in ----

  const authRequired = !!(deps.appPassword || deps.appToken);
  const limiter = new FailureLimiter();
  const clientKey = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";

  app.get("/api/auth", (c) => c.json({ required: authRequired, passwordLogin: !!deps.appPassword }));

  app.post("/api/login", async (c) => {
    if (!deps.appPassword) return c.json(err("bad_request", "Password sign-in is not set up on this server (APP_PASSWORD)"), 400);
    const key = clientKey(c);
    const t = now().getTime();
    if (limiter.blocked(key, t)) return c.json(err("unauthorized", "Too many wrong passwords. Try again in 15 minutes."), 429);
    let password = "";
    try {
      password = String((await c.req.json<{ password?: string }>()).password ?? "");
    } catch {
      /* empty body */
    }
    if (!password || !(await secretsMatch(password, deps.appPassword))) {
      limiter.fail(key, t);
      return c.json(err("unauthorized", "Wrong password"), 401);
    }
    limiter.clear(key);
    const token = newSessionToken();
    const at = now().toISOString();
    const device = describeDevice(c.req.header("User-Agent"));
    await deps.store.createSession({ tokenHash: await sha256Hex(token), createdAt: at, lastSeenAt: at, device });
    return c.json({ token, device });
  });

  app.use("/api/*", async (c, next) => {
    if (!authRequired) return next();
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token && deps.appToken && (await secretsMatch(token, deps.appToken))) return next();
    if (token) {
      const hash = await sha256Hex(token);
      const s = await deps.store.findSession(hash);
      if (s) {
        // Record when each device was last seen, at most once an hour.
        const at = now();
        if (at.getTime() - new Date(s.lastSeenAt).getTime() > 3_600_000) await deps.store.touchSession(hash, at.toISOString());
        c.set("sessionHash" as never, hash as never);
        return next();
      }
    }
    return c.json(err("unauthorized", "Please sign in"), 401);
  });

  app.post("/api/logout", async (c) => {
    const hash = c.get("sessionHash" as never) as string | undefined;
    if (hash) await deps.store.deleteSession(hash);
    return c.json({ ok: true });
  });

  app.post("/api/logout-all", async (c) => {
    await deps.store.deleteAllSessions();
    return c.json({ ok: true });
  });

  app.get("/api/sessions", async (c) => c.json({ count: await deps.store.countSessions() }));

  async function aiStatus(): Promise<AiStatus> {
    const monthUsd = await deps.store.monthSpendUsd(month());
    const overCap = monthUsd >= deps.capUsd;
    const capReason = deps.capUsd <= 0 ? "AI is switched off (cap is 0)" : overCap ? `Monthly AI cap of $${deps.capUsd} reached` : undefined;
    const er = deps.enricher.unavailableReason();
    const tr = deps.transcriber.unavailableReason();
    return {
      enrich: { available: !er && !capReason, provider: deps.enricher.name, reason: er ?? capReason },
      transcribe: { available: !tr && !capReason, provider: deps.transcriber.name, reason: tr ?? capReason },
      spend: { monthUsd: Math.round(monthUsd * 10000) / 10000, capUsd: deps.capUsd, overCap },
    };
  }

  /** Runs a paid call only if under the cap, and records what it cost. */
  async function withBudget<T>(kind: "enrich" | "transcribe", provider: string, fn: () => Promise<{ result: T; costUsd: number }>) {
    const status = await aiStatus();
    const s = kind === "enrich" ? status.enrich : status.transcribe;
    if (!s.available) {
      return { ok: false as const, status: status.spend.overCap || deps.capUsd <= 0 ? 402 : 503, body: err(status.spend.overCap || deps.capUsd <= 0 ? "over_cap" : "ai_unavailable", s.reason ?? "unavailable") };
    }
    const record = (costUsd: number) =>
      costUsd > 0
        ? deps.store.recordUsage({ id: crypto.randomUUID(), at: now().toISOString(), month: month(), kind, provider, costUsd })
        : Promise.resolve();
    try {
      const { result, costUsd } = await fn();
      await record(costUsd);
      return { ok: true as const, result };
    } catch (e) {
      const cost = (e as { costUsd?: number }).costUsd;
      if (cost) await record(cost);
      const retryable = e instanceof ProviderError ? e.retryable : true;
      console.error(`[${kind}] ${provider}:`, (e as Error).message);
      return { ok: false as const, status: retryable ? 503 : 422, body: err("provider_error", (e as Error).message) };
    }
  }

  app.get("/api/health", async (c) => {
    const body: HealthResponse = { ok: true, storage: `${deps.store.name}+${deps.blobs.name}`, ai: await aiStatus(), serverTime: now().toISOString() };
    return c.json(body);
  });

  // ---- Ideas (sync) ----

  app.get("/api/ideas", async (c) => {
    const since = c.req.query("since") || undefined;
    const serverTime = now().toISOString();
    const rows = await deps.store.listIdeas(since);
    return c.json({ ideas: rows.map((r) => r.idea), serverTime });
  });

  app.get("/api/ideas/:id", async (c) => {
    const idea = await deps.store.getIdea(c.req.param("id"));
    return idea ? c.json(idea) : c.json(err("not_found", "No such idea"), 404);
  });

  app.put("/api/ideas/:id", async (c) => {
    const raw = await c.req.text();
    if (raw.length > MAX_IDEA_BYTES) return c.json(err("bad_request", "Idea too large"), 413);
    let idea: unknown;
    try {
      idea = JSON.parse(raw);
    } catch {
      return c.json(err("bad_request", "Invalid JSON"), 400);
    }
    if (!isValidIdea(idea) || idea.id !== c.req.param("id") || !SAFE_ID.test(idea.id)) {
      return c.json(err("bad_request", "Not a valid idea"), 400);
    }
    const stored = await deps.store.putIdea(idea, now().toISOString());
    return c.json(stored);
  });

  // ---- Audio (originals kept permanently) ----

  app.put("/api/audio/:id", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json(err("bad_request", "Bad audio id"), 400);
    const mime = (c.req.header("Content-Type") || "application/octet-stream").slice(0, 100);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) return c.json(err("bad_request", "Empty audio"), 400);
    if (bytes.byteLength > MAX_AUDIO_BYTES) return c.json(err("bad_request", "Audio too large"), 413);
    // Audio is write-once: an original is never replaced.
    if (!(await deps.blobs.has(id))) await deps.blobs.put(id, bytes, mime);
    return c.json({ ok: true, id, bytes: bytes.byteLength });
  });

  app.on("HEAD", "/api/audio/:id", async (c) => {
    const id = c.req.param("id");
    return c.body(null, SAFE_ID.test(id) && (await deps.blobs.has(id)) ? 200 : 404);
  });

  app.get("/api/audio/:id", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json(err("bad_request", "Bad audio id"), 400);
    const blob = await deps.blobs.get(id);
    if (!blob) return c.json(err("not_found", "No such audio"), 404);
    return c.body(blob.bytes as never, 200, { "Content-Type": blob.mime, "Cache-Control": "private, max-age=31536000, immutable" });
  });

  // ---- AI ----

  app.post("/api/transcribe/:audioId", async (c) => {
    const id = c.req.param("audioId");
    if (!SAFE_ID.test(id)) return c.json(err("bad_request", "Bad audio id"), 400);
    const blob = await deps.blobs.get(id);
    if (!blob) return c.json(err("not_found", "Upload the audio first"), 404);
    const durationMs = Math.max(0, Number(c.req.query("durationMs")) || 0) || 60_000;
    const lang = c.req.query("language");
    const language = lang && /^[a-z]{2}$/.test(lang) ? lang : undefined;
    const r = await withBudget("transcribe", deps.transcriber.name, () => deps.transcriber.transcribe(blob.bytes, blob.mime, durationMs, language));
    return r.ok ? c.json(r.result) : c.json(r.body, r.status as 402);
  });

  app.post("/api/enrich", async (c) => {
    let body: EnrichRequest;
    try {
      body = await c.req.json<EnrichRequest>();
    } catch {
      return c.json(err("bad_request", "Invalid JSON"), 400);
    }
    if (!Array.isArray(body?.words) || body.words.length === 0) return c.json(err("bad_request", "No words"), 400);
    const words = body.words
      .slice(0, 50)
      .map((w) => ({ kind: w.kind, text: String(w.text ?? "").slice(0, 20_000), question: w.question ? String(w.question).slice(0, 300) : undefined }))
      .filter((w) => w.text.trim());
    if (words.length === 0) return c.json(err("bad_request", "No words"), 400);
    const r = await withBudget("enrich", deps.enricher.name, () => deps.enricher.enrich({ words, wantQuestions: !!body.wantQuestions }));
    return r.ok ? c.json(r.result) : c.json(r.body, r.status as 402);
  });

  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json(err("not_found", "Not found"), 404) : c.text("Not found", 404)));
  app.onError((e, c) => {
    console.error(e);
    return c.json({ error: "provider_error", message: "Server error" }, 500);
  });

  return app;
}
