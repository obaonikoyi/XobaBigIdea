// IndexedDB: the source of truth on this device. Everything is written here first;
// the server is only a copy for backup and other devices.
import type { Idea } from "@xoba/shared";

export interface AudioRecord {
  id: string;
  ideaId: string;
  mime: string;
  /** Stored as ArrayBuffer (not Blob) for reliable storage across browsers. */
  bytes: ArrayBuffer;
  durationMs: number;
  createdAt: string;
  uploaded: boolean;
}

export interface AudioChunk {
  audioId: string;
  seq: number;
  bytes: ArrayBuffer;
}

const DB_NAME = "xoba-big-idea";
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("ideas", { keyPath: "id" });
      const audio = db.createObjectStore("audio", { keyPath: "id" });
      audio.createIndex("ideaId", "ideaId");
      db.createObjectStore("chunks", { keyPath: ["audioId", "seq"] });
      db.createObjectStore("outbox", { keyPath: "id" }); // ids of ideas waiting to sync
      db.createObjectStore("meta"); // key/value: settings, sync cursor, recording sessions, reviews
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export async function closeDb() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

type StoreName = "ideas" | "audio" | "chunks" | "outbox" | "meta";

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const finished = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("transaction aborted"));
  });
  const result = await fn(t);
  await finished;
  return result;
}

// ---- ideas ----

export const getIdea = (id: string) => tx(["ideas"], "readonly", (t) => done(t.objectStore("ideas").get(id) as IDBRequest<Idea | undefined>));
export const allIdeas = () => tx(["ideas"], "readonly", (t) => done(t.objectStore("ideas").getAll() as IDBRequest<Idea[]>));

/** Save an idea and mark it for sync, in one transaction. */
export function putIdea(idea: Idea, markDirty = true) {
  return tx(["ideas", "outbox"], "readwrite", (t) => {
    t.objectStore("ideas").put(idea);
    if (markDirty) t.objectStore("outbox").put({ id: idea.id });
  });
}

export const outboxIds = () => tx(["outbox"], "readonly", async (t) => ((await done(t.objectStore("outbox").getAll())) as { id: string }[]).map((r) => r.id));

/** Clear the dirty flag, but only if the idea has not changed since it was sent. */
export function markSynced(id: string, sentUpdatedAt: string) {
  return tx(["ideas", "outbox"], "readwrite", async (t) => {
    const cur = (await done(t.objectStore("ideas").get(id))) as Idea | undefined;
    if (!cur || cur.updatedAt === sentUpdatedAt) t.objectStore("outbox").delete(id);
  });
}

// ---- audio ----

export const getAudio = (id: string) => tx(["audio"], "readonly", (t) => done(t.objectStore("audio").get(id) as IDBRequest<AudioRecord | undefined>));
export const allAudio = () => tx(["audio"], "readonly", (t) => done(t.objectStore("audio").getAll() as IDBRequest<AudioRecord[]>));
export const putAudio = (a: AudioRecord) => tx(["audio"], "readwrite", (t) => void t.objectStore("audio").put(a));
export type AudioMeta = Omit<AudioRecord, "bytes"> & { size: number };
export async function audioMeta(): Promise<AudioMeta[]> {
  // Walks a cursor so we do not hold every recording in memory at once.
  return tx(["audio"], "readonly", (t) => new Promise((resolve, reject) => {
    const out: AudioMeta[] = [];
    const req = t.objectStore("audio").openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      const { bytes, ...rest } = c.value as AudioRecord;
      out.push({ ...rest, size: bytes.byteLength });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

// ---- recording chunks (crash safety while recording) ----

export const putChunk = (c: AudioChunk) => tx(["chunks"], "readwrite", (t) => void t.objectStore("chunks").put(c));
export function chunksFor(audioId: string) {
  return tx(["chunks"], "readonly", async (t) => {
    const range = IDBKeyRange.bound([audioId, 0], [audioId, Number.MAX_SAFE_INTEGER]);
    return (await done(t.objectStore("chunks").getAll(range))) as AudioChunk[];
  });
}
export function deleteChunks(audioId: string) {
  return tx(["chunks"], "readwrite", (t) => void t.objectStore("chunks").delete(IDBKeyRange.bound([audioId, 0], [audioId, Number.MAX_SAFE_INTEGER])));
}

/** Store the finished recording and remove its chunks atomically. */
export function finishAudio(a: AudioRecord) {
  return tx(["audio", "chunks"], "readwrite", (t) => {
    t.objectStore("audio").put(a);
    t.objectStore("chunks").delete(IDBKeyRange.bound([a.id, 0], [a.id, Number.MAX_SAFE_INTEGER]));
  });
}

// ---- meta ----

export const getMeta = <T>(key: string) => tx(["meta"], "readonly", (t) => done(t.objectStore("meta").get(key) as IDBRequest<T | undefined>));
export const setMeta = (key: string, value: unknown) => tx(["meta"], "readwrite", (t) => void t.objectStore("meta").put(value, key));
export const delMeta = (key: string) => tx(["meta"], "readwrite", (t) => void t.objectStore("meta").delete(key));
export const metaKeys = () => tx(["meta"], "readonly", (t) => done(t.objectStore("meta").getAllKeys())) as Promise<string[]>;

/** Wipe everything on this device (used by tests and "restore into empty app"). */
export function wipeAll() {
  return tx(["ideas", "audio", "chunks", "outbox", "meta"], "readwrite", (t) => {
    for (const s of ["ideas", "audio", "chunks", "outbox", "meta"] as const) t.objectStore(s).clear();
  });
}
