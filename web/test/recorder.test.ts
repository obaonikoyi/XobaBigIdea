import { describe, expect, it } from "vitest";
import * as db from "../src/lib/db";
import { recoverInterruptedRecordings } from "../src/lib/recorder";

describe("interrupted recording", () => {
  it("is rebuilt from saved chunks on the next app start", async () => {
    const startedAt = "2026-09-20T21:15:00.000Z";
    await db.setMeta("recording:aud1", { audioId: "aud1", ideaId: "idea1", isNew: true, mime: "audio/webm", startedAt, text: "hook idea" });
    await db.putChunk({ audioId: "aud1", seq: 1, bytes: new Uint8Array([4, 5]).buffer });
    await db.putChunk({ audioId: "aud1", seq: 0, bytes: new Uint8Array([1, 2, 3]).buffer });

    expect(await recoverInterruptedRecordings()).toBe(1);

    const audio = await db.getAudio("aud1");
    expect([...new Uint8Array(audio!.bytes)]).toEqual([1, 2, 3, 4, 5]);
    const idea = await db.getIdea("idea1");
    expect(idea?.createdAt).toBe(startedAt);
    expect(idea?.entries[0]).toMatchObject({ text: "hook idea", audioId: "aud1", transcriptStatus: "pending" });
    expect(await db.chunksFor("aud1")).toHaveLength(0);
    // Running again does nothing and does not duplicate.
    expect(await recoverInterruptedRecordings()).toBe(0);
    expect((await db.getIdea("idea1"))?.entries).toHaveLength(1);
  });

  it("keeps the live words heard before the app closed, as the transcript", async () => {
    await db.setMeta("recording:aud2", { audioId: "aud2", ideaId: "idea2", isNew: true, mime: "audio/webm", startedAt: "2026-09-20T21:15:00.000Z", text: "", liveText: "oya make we go" });
    await db.putChunk({ audioId: "aud2", seq: 0, bytes: new Uint8Array([1]).buffer });
    await recoverInterruptedRecordings();
    const e = (await db.getIdea("idea2"))!.entries[0];
    expect(e).toMatchObject({ transcript: "oya make we go", transcriptStatus: "done", transcriptSource: "live", audioId: "aud2" });
  });
});
