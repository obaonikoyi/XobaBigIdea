import type { R2Bucket } from "@cloudflare/workers-types";
import type { BlobStore } from "./types.js";

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Audio on local disk: <dir>/<id>.bin plus <id>.json holding the mime type. */
export async function fsBlobStore(dir: string): Promise<BlobStore> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(dir, { recursive: true });
  const file = (id: string, ext: string) => {
    if (!SAFE_ID.test(id)) throw new Error("bad id");
    return path.join(dir, `${id}.${ext}`);
  };
  return {
    name: "filesystem",
    async put(id, bytes, mime) {
      // Write data first, then metadata, via temp files so a crash never leaves a half file.
      await fs.writeFile(file(id, "bin.tmp"), bytes);
      await fs.rename(file(id, "bin.tmp"), file(id, "bin"));
      await fs.writeFile(file(id, "json"), JSON.stringify({ mime }));
    },
    async get(id) {
      try {
        const [bytes, meta] = await Promise.all([fs.readFile(file(id, "bin")), fs.readFile(file(id, "json"), "utf8")]);
        return { bytes: new Uint8Array(bytes), mime: JSON.parse(meta).mime };
      } catch {
        return null;
      }
    },
    async has(id) {
      try {
        await fs.access(file(id, "json"));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Audio in Cloudflare R2 (10 GB free). */
export function r2BlobStore(bucket: R2Bucket): BlobStore {
  return {
    name: "cloudflare-r2",
    async put(id, bytes, mime) {
      await bucket.put(`audio/${id}`, bytes, { httpMetadata: { contentType: mime } });
    },
    async get(id) {
      const obj = await bucket.get(`audio/${id}`);
      if (!obj) return null;
      return { bytes: new Uint8Array(await obj.arrayBuffer()), mime: obj.httpMetadata?.contentType ?? "application/octet-stream" };
    },
    async has(id) {
      return (await bucket.head(`audio/${id}`)) !== null;
    },
  };
}

/** In-memory, for tests. */
export function memoryBlobStore(): BlobStore {
  const m = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    name: "memory",
    async put(id, bytes, mime) {
      m.set(id, { bytes, mime });
    },
    async get(id) {
      return m.get(id) ?? null;
    },
    async has(id) {
      return m.has(id);
    },
  };
}
