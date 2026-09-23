import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import * as db from "../src/lib/db";
import { createIdea, setStatus } from "../src/lib/ideas";
import { buildExport, restoreExport } from "../src/lib/exportRestore";

async function seed() {
  const song = await createIdea({ text: "Chorus: ṣé o gbọ́? e go better", audio: { id: "aud1", mime: "audio/webm", durationMs: 4000 } });
  await db.putAudio({ id: "aud1", ideaId: song.id, mime: "audio/webm", bytes: new Uint8Array([10, 20, 30, 40]).buffer, durationMs: 4000, createdAt: song.createdAt, uploaded: true });
  const biz = await createIdea({ text: "Mama put delivery app" });
  return { song, biz };
}

describe("export and restore", () => {
  it("round-trips text, audio and metadata into an empty app", async () => {
    const { song, biz } = await seed();
    await setStatus(biz.id, "later");
    const zip = await buildExport();

    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["README.txt", "audio/aud1.webm", "ideas.json", "ideas.md"]);
    expect(strFromU8(files["ideas.md"])).toContain("Chorus: ṣé o gbọ́? e go better");

    await db.wipeAll();
    expect(await db.allIdeas()).toHaveLength(0);

    const r = await restoreExport(zip);
    expect(r).toMatchObject({ added: 2, updated: 0, audioAdded: 1, skipped: 0 });
    const restoredSong = await db.getIdea(song.id);
    expect(restoredSong?.entries[0].text).toBe("Chorus: ṣé o gbọ́? e go better");
    expect(restoredSong?.createdAt).toBe(song.createdAt);
    expect((await db.getIdea(biz.id))?.status).toBe("later");
    const audio = await db.getAudio("aud1");
    expect([...new Uint8Array(audio!.bytes)]).toEqual([10, 20, 30, 40]);
    expect(audio?.uploaded).toBe(false); // will be re-uploaded to a fresh server
    expect((await db.outboxIds()).sort()).toEqual([song.id, biz.id].sort());
  });

  it("merges without losing newer local changes, and is safe to run twice", async () => {
    const { biz } = await seed();
    const zip = await buildExport();
    await setStatus(biz.id, "chosen"); // newer than the export
    const r = await restoreExport(zip);
    expect(r).toMatchObject({ added: 0, updated: 0, unchanged: 2, audioAdded: 0 });
    expect((await db.getIdea(biz.id))?.status).toBe("chosen");
  });

  it("rejects files that are not exports", async () => {
    await expect(restoreExport(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a Xoba Big Idea export/);
  });
});
