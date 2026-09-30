// Cloudflare Workers entry (free tier): D1 for ideas, R2 for audio, Workers AI optional.
// The built web app is served by Workers static assets (see wrangler.toml).
import type { Ai, D1Database, R2Bucket } from "@cloudflare/workers-types";
import { createApp } from "./app.js";
import { capUsd, pickEnricher, pickTranscriber } from "./config.js";
import { SqlIdeaStore } from "./providers/sql.js";
import { d1Db } from "./providers/d1.js";
import { r2BlobStore } from "./providers/blobs.js";

interface Bindings {
  DB: D1Database;
  AUDIO: R2Bucket;
  AI?: Ai;
  ASSETS: { fetch(req: Request): Promise<Response> };
  [key: string]: unknown;
}

let app: ReturnType<typeof createApp> | undefined;
let ready: Promise<void> | undefined;

export default {
  async fetch(req: Request, env: Bindings) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (!app) {
      const vars = env as unknown as Record<string, string | undefined>;
      const store = new SqlIdeaStore(d1Db(env.DB));
      ready = store.init();
      app = createApp({
        store,
        blobs: r2BlobStore(env.AUDIO),
        enricher: pickEnricher(vars, env.AI),
        transcriber: pickTranscriber(vars, env.AI),
        capUsd: capUsd(vars),
        appToken: vars.APP_TOKEN || undefined,
      });
    }
    await ready;
    return app.fetch(req);
  },
};
