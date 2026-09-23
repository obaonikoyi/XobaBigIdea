// HTTP client for the backend. The backend is swappable: anything that speaks
// docs/API.md works (the bundled Node server, Cloudflare Worker, or a FastAPI port).
import type { EnrichRequest, EnrichResult, HealthResponse, Idea, TranscribeResult } from "@xoba/shared";
import * as db from "./db";

export interface Settings {
  /** Empty means same origin as the app. */
  serverUrl: string;
  token: string;
}

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<Settings> {
  return { serverUrl: "", token: "", ...((await db.getMeta<Settings>(SETTINGS_KEY)) ?? {}) };
}

export async function saveSettings(s: Settings) {
  await db.setMeta(SETTINGS_KEY, { serverUrl: s.serverUrl.trim().replace(/\/+$/, ""), token: s.token.trim() });
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
  /** AI is off, over the cap, or the provider is down: try again later, never block the user. */
  get aiUnavailable() {
    return this.status === 402 || this.status === 503 || this.code === "ai_unavailable" || this.code === "over_cap";
  }
}

/** fetch is injectable so tests can point the client at an in-process server. */
let fetcher: typeof fetch = (...args) => fetch(...args);
export function setFetch(f: typeof fetch) {
  fetcher = f;
}

async function call(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const s = await getSettings();
  const headers = new Headers(init.headers);
  if (s.token) headers.set("Authorization", `Bearer ${s.token}`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${s.serverUrl}${path}`, { ...init, headers, signal: ctl.signal });
    if (!res.ok) {
      let code: string | undefined;
      let message = `${res.status}`;
      try {
        const b = await res.json();
        code = b.error;
        message = b.message ?? message;
      } catch {
        /* not json */
      }
      throw new ApiError(message, res.status, code);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

export const api = {
  health: async () => (await (await call("/api/health", {}, 8000)).json()) as HealthResponse,
  putIdea: async (idea: Idea) => (await (await call(`/api/ideas/${idea.id}`, jsonInit("PUT", idea))).json()) as Idea,
  listIdeas: async (since?: string) =>
    (await (await call(`/api/ideas${since ? `?since=${encodeURIComponent(since)}` : ""}`)).json()) as { ideas: Idea[]; serverTime: string },
  putAudio: async (id: string, bytes: ArrayBuffer, mime: string) =>
    void (await call(`/api/audio/${id}`, { method: "PUT", body: bytes, headers: { "Content-Type": mime } }, 300_000)),
  getAudio: async (id: string) => {
    const res = await call(`/api/audio/${id}`, {}, 300_000);
    return { bytes: await res.arrayBuffer(), mime: res.headers.get("Content-Type") ?? "audio/webm" };
  },
  transcribe: async (audioId: string, durationMs: number) =>
    (await (await call(`/api/transcribe/${audioId}?durationMs=${Math.round(durationMs)}`, { method: "POST" }, 300_000)).json()) as TranscribeResult,
  enrich: async (req: EnrichRequest) => (await (await call("/api/enrich", jsonInit("POST", req), 120_000)).json()) as EnrichResult,
};
