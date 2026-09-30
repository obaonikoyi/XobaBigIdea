// Export everything to one .zip (ideas as JSON and as readable text, plus every
// original audio file) and restore it again. Restore merges: it never deletes,
// and a newer copy of an idea always wins.
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from "fflate";
import { IDEA_TYPE_LABELS, STATUS_LABELS, isValidIdea, type Idea } from "@xoba/shared";
import * as db from "./db";
import { displayTitle } from "./ideas";
import { emitChange } from "./events";

export const EXPORT_VERSION = 1;

interface Manifest {
  app: "xoba-big-idea";
  version: number;
  exportedAt: string;
  ideas: Idea[];
  audio: { id: string; ideaId: string; mime: string; durationMs: number; createdAt: string; file: string }[];
}

export function extFor(mime: string) {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "bin";
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A human-readable copy, so the export is useful even without this app. */
export function ideasToMarkdown(ideas: Idea[], audioFiles: Map<string, string>) {
  const out = ["# Xoba Big Idea export", "", `Exported ${fmt(new Date().toISOString())}. ${ideas.length} ideas.`, ""];
  for (const i of [...ideas].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    out.push(`## ${displayTitle(i)}`, "");
    out.push(`- Captured: ${fmt(i.createdAt)}`, `- Type: ${IDEA_TYPE_LABELS[i.type.value]}`, `- Status: ${STATUS_LABELS[i.status]}`, `- Priority: ${i.priority ?? "Not set"}`);
    if (i.summary.value) out.push(`- Summary${i.summary.source === "ai" ? " (AI suggestion)" : ""}: ${i.summary.value}`);
    out.push("", "### My words", "");
    for (const e of i.entries) {
      const label = e.kind === "capture" ? "Original" : e.kind === "answer" ? `Answer to "${e.question}"` : "Added thought";
      out.push(`**${label}, ${fmt(e.createdAt)}**`, "");
      if (e.text) out.push(e.text, "");
      if (e.audioId) out.push(`Audio: ${audioFiles.get(e.audioId) ?? "(not on this device)"}`, "");
      if (e.transcript) out.push(`Transcript (automatic${e.transcriptEditedByMe ? ", corrected by me" : ""}):`, "", "> " + e.transcript.replace(/\n/g, "\n> "), "");
    }
  }
  return out.join("\n");
}

export async function buildExport(): Promise<Uint8Array> {
  const ideas = await db.allIdeas();
  const files: Zippable = {};
  const manifest: Manifest = { app: "xoba-big-idea", version: EXPORT_VERSION, exportedAt: new Date().toISOString(), ideas, audio: [] };
  const audioFiles = new Map<string, string>();
  for (const meta of await db.audioMeta()) {
    const a = await db.getAudio(meta.id);
    if (!a) continue;
    const file = `audio/${a.id}.${extFor(a.mime)}`;
    // Audio is already compressed; store without re-compressing.
    files[file] = [new Uint8Array(a.bytes), { level: 0 }];
    audioFiles.set(a.id, file);
    manifest.audio.push({ id: a.id, ideaId: a.ideaId, mime: a.mime, durationMs: a.durationMs, createdAt: a.createdAt, file });
  }
  files["ideas.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["ideas.md"] = strToU8(ideasToMarkdown(ideas, audioFiles));
  files["README.txt"] = strToU8(
    "Xoba Big Idea export.\n\nideas.json  - everything, for restoring into the app (Settings > Restore)\nideas.md    - the same ideas as readable text\naudio/      - your original recordings, unchanged\n",
  );
  return zipSync(files);
}

export interface RestoreResult {
  added: number;
  updated: number;
  unchanged: number;
  audioAdded: number;
  skipped: number;
}

export async function restoreExport(zip: Uint8Array): Promise<RestoreResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new Error("That file is not a Xoba Big Idea export (not a zip).");
  }
  if (!entries["ideas.json"]) throw new Error("That file is not a Xoba Big Idea export (no ideas.json).");
  const manifest = JSON.parse(strFromU8(entries["ideas.json"])) as Manifest;
  if (manifest.app !== "xoba-big-idea" || !Array.isArray(manifest.ideas)) throw new Error("Unrecognised export file.");
  if (manifest.version > EXPORT_VERSION) throw new Error("This export is from a newer version of the app.");

  const result: RestoreResult = { added: 0, updated: 0, unchanged: 0, audioAdded: 0, skipped: 0 };
  for (const a of manifest.audio ?? []) {
    const bytes = entries[a.file];
    if (!bytes || (await db.getAudio(a.id))) continue;
    const copy = bytes.slice().buffer;
    await db.putAudio({ id: a.id, ideaId: a.ideaId, mime: a.mime, bytes: copy, durationMs: a.durationMs, createdAt: a.createdAt, uploaded: false });
    result.audioAdded++;
  }
  for (const idea of manifest.ideas) {
    if (!isValidIdea(idea)) {
      result.skipped++;
      continue;
    }
    const local = await db.getIdea(idea.id);
    if (!local) {
      await db.putIdea(idea);
      result.added++;
    } else if (idea.updatedAt > local.updatedAt) {
      await db.putIdea(idea);
      result.updated++;
    } else result.unchanged++;
  }
  emitChange();
  return result;
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/zip") {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
