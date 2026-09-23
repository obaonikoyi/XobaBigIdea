// Background work: push local changes, pull changes from other devices, upload
// audio, then (only if AI is available and under the cap) transcribe and enrich.
// Nothing here ever blocks capture, browsing or replay.
import type { AiStatus, Idea } from "@xoba/shared";
import * as db from "./db";
import { api, ApiError } from "./api";
import { applyEnrichment, setTranscript } from "./ideas";
import { emitChange } from "./events";

export interface SyncState {
  online: boolean;
  serverReachable: boolean | null;
  lastSyncAt?: string;
  lastError?: string;
  pending: number;
  ai?: AiStatus;
  running: boolean;
}

let state: SyncState = { online: typeof navigator === "undefined" ? true : navigator.onLine, serverReachable: null, pending: 0, running: false };
const listeners = new Set<(s: SyncState) => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
};
export const getSyncState = () => state;
export function onSyncState(l: (s: SyncState) => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const CURSOR_KEY = "sync.cursor";

/** Push dirty ideas and any audio not yet on the server. */
export async function push() {
  for (const a of await db.audioMeta()) {
    if (a.uploaded) continue;
    const full = await db.getAudio(a.id);
    if (!full) continue;
    await api.putAudio(full.id, full.bytes, full.mime);
    await db.putAudio({ ...full, uploaded: true });
  }
  for (const id of await db.outboxIds()) {
    const idea = await db.getIdea(id);
    if (!idea) continue;
    const stored = await api.putIdea(idea);
    // The server keeps the newer copy. If that is not ours, take it.
    if (stored.updatedAt > idea.updatedAt) await db.putIdea(stored, false);
    await db.markSynced(id, idea.updatedAt);
  }
}

/** Pull ideas changed elsewhere. Last write wins, by updatedAt. */
export async function pull() {
  const since = await db.getMeta<string>(CURSOR_KEY);
  const { ideas, serverTime } = await api.listIdeas(since);
  let changed = false;
  for (const remote of ideas) {
    const local = await db.getIdea(remote.id);
    if (!local || remote.updatedAt > local.updatedAt) {
      await db.putIdea(remote, false);
      changed = true;
    }
  }
  await db.setMeta(CURSOR_KEY, serverTime);
  if (changed) emitChange();
}

function needsEnrichment(idea: Idea) {
  if (idea.ai && idea.ai.basedOnEntries >= idea.entries.length) return false;
  // Wait for transcripts that are still coming, so the AI sees the words.
  if (idea.entries.some((e) => e.transcriptStatus === "pending")) return false;
  return idea.entries.some((e) => e.text.trim() || e.transcript?.trim());
}

/** Transcribe pending audio and enrich ideas. Stops quietly when AI is unavailable. */
export async function processAi(ai: AiStatus) {
  const ideas = await db.allIdeas();
  if (ai.transcribe.available) {
    outer: for (const idea of ideas) {
      for (const e of idea.entries) {
        if (e.transcriptStatus !== "pending" || !e.audioId) continue;
        const audio = await db.getAudio(e.audioId);
        if (audio && !audio.uploaded) continue; // push() uploads it first
        try {
          const r = await api.transcribe(e.audioId, e.audioDurationMs ?? audio?.durationMs ?? 60_000);
          await setTranscript(idea.id, e.id, r.text, "done");
        } catch (err) {
          if (err instanceof ApiError && err.aiUnavailable) break outer;
          if (err instanceof ApiError && err.status === 422) await setTranscript(idea.id, e.id, "", "failed");
          else throw err;
        }
      }
    }
  }
  if (!ai.enrich.available) return;
  for (const idea of await db.allIdeas()) {
    if (!needsEnrichment(idea)) continue;
    const words = idea.entries
      .map((e) => ({ kind: e.kind, question: e.question, text: [e.text, e.transcript].filter((t) => t && t.trim()).join("\n") }))
      .filter((w) => w.text);
    try {
      const r = await api.enrich({ words, wantQuestions: !idea.ai && idea.followUps.length === 0 });
      await applyEnrichment(idea.id, r, idea.entries.length);
    } catch (err) {
      if (err instanceof ApiError && err.aiUnavailable) return;
      if (err instanceof ApiError && err.status === 422) {
        // The AI could not handle this one; do not keep retrying it.
        await applyEnrichment(idea.id, { title: idea.title.value, type: idea.type.value, summary: idea.summary.value, questions: [], provider: "skipped" }, idea.entries.length);
      } else throw err;
    }
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Run one full sync. Safe to call often; calls while running are coalesced. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      set({ running: true });
      try {
        await push();
        await pull();
        const health = await api.health();
        set({ serverReachable: true, ai: health.ai, lastError: undefined });
        await processAi(health.ai);
        await push(); // send transcripts and suggestions back up
        set({ lastSyncAt: new Date().toISOString() });
      } catch (err) {
        const unreachable = !(err instanceof ApiError);
        const message = err instanceof ApiError && err.status === 401 ? "wrong app token" : (err as Error).message;
        set({ serverReachable: unreachable ? false : true, lastError: unreachable ? undefined : message });
      } finally {
        set({ running: false, pending: (await db.outboxIds()).length });
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function refreshPending() {
  set({ pending: (await db.outboxIds()).length });
}

/** Get audio for playback: local copy first, otherwise download and keep it. */
export async function loadAudio(audioId: string, ideaId: string): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const local = await db.getAudio(audioId);
  if (local) return local;
  try {
    const remote = await api.getAudio(audioId);
    await db.putAudio({ id: audioId, ideaId, mime: remote.mime, bytes: remote.bytes, durationMs: 0, createdAt: new Date().toISOString(), uploaded: true });
    return remote;
  } catch {
    return null;
  }
}

/** Start background syncing: now, when back online, when the tab is shown, and every minute. */
export function startBackgroundSync() {
  const kick = () => void syncNow();
  window.addEventListener("online", () => {
    set({ online: true });
    kick();
  });
  window.addEventListener("offline", () => set({ online: false }));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && kick());
  setInterval(kick, 60_000);
  kick();
}
