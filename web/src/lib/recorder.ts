// Voice capture. Audio is written to IndexedDB every second while recording,
// so closing the app or a crash mid-song loses at most about a second.
import * as db from "./db";
import { addThought, answerFollowUp, createIdea, newId, now } from "./ideas";

export interface RecordingTarget {
  /** Add to this idea instead of creating a new one. */
  ideaId?: string;
  /** Record as the answer to this follow-up question. */
  followUpId?: string;
}

interface Session {
  audioId: string;
  ideaId: string;
  isNew: boolean;
  followUpId?: string;
  mime: string;
  startedAt: string;
  /** Text typed before recording started, saved with the audio. */
  text: string;
}

const SESSION_PREFIX = "recording:";
const TIMESLICE_MS = 1000;

export function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export class VoiceRecorder {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private session?: Session;
  private seq = 0;
  private writes: Promise<void>[] = [];
  private startMs = 0;

  get active() {
    return !!this.rec;
  }

  get audioId() {
    return this.session?.audioId;
  }

  elapsedMs() {
    return this.rec ? Date.now() - this.startMs : 0;
  }

  async start(target: RecordingTarget = {}, text = "") {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    const mime = pickMime();
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const at = now();
    this.session = {
      audioId: newId(),
      ideaId: target.ideaId ?? newId(),
      isNew: !target.ideaId,
      followUpId: target.followUpId,
      mime: rec.mimeType || mime || "audio/webm",
      startedAt: at.toISOString(),
      text,
    };
    await db.setMeta(SESSION_PREFIX + this.session.audioId, this.session);
    this.seq = 0;
    this.writes = [];
    const audioId = this.session.audioId;
    rec.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      const seq = this.seq++;
      this.writes.push(ev.data.arrayBuffer().then((bytes) => db.putChunk({ audioId, seq, bytes })));
    };
    rec.start(TIMESLICE_MS);
    this.rec = rec;
    this.startMs = Date.now();
  }

  /** Stop and save. Returns the idea id the recording was saved to. */
  async stop(text?: string): Promise<string> {
    const rec = this.rec;
    const session = this.session;
    if (!rec || !session) throw new Error("not recording");
    const durationMs = Date.now() - this.startMs;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    await Promise.all(this.writes);
    this.rec = undefined;
    this.stream = undefined;
    this.session = undefined;
    if (text !== undefined) session.text = text;
    await finalize(session, durationMs);
    return session.ideaId;
  }

  /** Stop without saving (the user pressed cancel). */
  async discard() {
    const session = this.session;
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    await Promise.all(this.writes);
    this.rec = undefined;
    this.session = undefined;
    if (session) {
      await db.deleteChunks(session.audioId);
      await db.delMeta(SESSION_PREFIX + session.audioId);
    }
  }
}

/** Turns stored chunks into a saved audio file and an idea entry. Safe to run twice. */
async function finalize(s: Session, durationMs: number) {
  let audio = await db.getAudio(s.audioId);
  if (!audio) {
    const chunks = (await db.chunksFor(s.audioId)).sort((a, b) => a.seq - b.seq);
    if (chunks.length === 0) {
      await db.delMeta(SESSION_PREFIX + s.audioId);
      if (s.text.trim()) await saveEntry(s, undefined);
      return;
    }
    const total = chunks.reduce((n, c) => n + c.bytes.byteLength, 0);
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(new Uint8Array(c.bytes), off);
      off += c.bytes.byteLength;
    }
    audio = { id: s.audioId, ideaId: s.ideaId, mime: s.mime, bytes: bytes.buffer, durationMs: durationMs || chunks.length * TIMESLICE_MS, createdAt: s.startedAt, uploaded: false };
    await db.finishAudio(audio);
  }
  await saveEntry(s, audio);
  await db.delMeta(SESSION_PREFIX + s.audioId);
}

async function saveEntry(s: Session, audio: db.AudioRecord | undefined) {
  const input = { text: s.text, at: new Date(s.startedAt), audio: audio && { id: audio.id, mime: audio.mime, durationMs: audio.durationMs } };
  const existing = await db.getIdea(s.ideaId);
  if (existing?.entries.some((e) => e.audioId === s.audioId)) return; // already saved
  if (s.isNew && !existing) await createIdea(input, s.ideaId);
  else if (s.followUpId) await answerFollowUp(s.ideaId, s.followUpId, input);
  else await addThought(s.ideaId, input);
}

/**
 * On app start: any recording that was interrupted (tab closed, crash, battery)
 * is rebuilt from its chunks and saved. Returns how many were recovered.
 */
export async function recoverInterruptedRecordings(activeAudioId?: string): Promise<number> {
  const keys = (await db.metaKeys()).filter((k) => typeof k === "string" && k.startsWith(SESSION_PREFIX));
  let n = 0;
  for (const key of keys) {
    const s = await db.getMeta<Session>(key);
    if (!s || s.audioId === activeAudioId) continue;
    await finalize(s, 0);
    n++;
  }
  return n;
}
