// Node entry: `npm start`. Storage is SQLite (default) or Postgres (DATABASE_URL);
// audio goes to DATA_DIR/audio. Also serves the built web app from ../web/dist.
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import fs from "node:fs";
import { createApp } from "./app.js";
import { capUsd, pickEnricher, pickTranscriber } from "./config.js";
import { SqlIdeaStore } from "./providers/sql.js";
import { fsBlobStore } from "./providers/blobs.js";

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR || "./data");
fs.mkdirSync(dataDir, { recursive: true });

const db = env.DATABASE_URL
  ? await (await import("./providers/postgres.js")).openPostgres(env.DATABASE_URL)
  : await (await import("./providers/sqlite-node.js")).openNodeSqlite(path.join(dataDir, "xoba.sqlite"));
const store = new SqlIdeaStore(db);
await store.init();

const api = createApp({
  store,
  blobs: await fsBlobStore(path.join(dataDir, "audio")),
  enricher: pickEnricher(env),
  transcriber: pickTranscriber(env),
  capUsd: capUsd(env),
  appToken: env.APP_TOKEN || undefined,
  corsOrigin: env.CORS_ORIGIN || undefined,
});

const webDist = path.resolve(env.WEB_DIST || new URL("../../web/dist", import.meta.url).pathname);
if (fs.existsSync(webDist)) {
  const root = path.relative(process.cwd(), webDist);
  api.use("/*", serveStatic({ root }));
  api.get("*", serveStatic({ path: path.join(root, "index.html") }));
}

const port = Number(env.PORT || 8787);
serve({ fetch: api.fetch, port }, () => {
  console.log(`Xoba Big Idea on http://localhost:${port}  storage=${store.name} ai=${pickEnricher(env).name} transcribe=${pickTranscriber(env).name} cap=$${capUsd(env)}/month`);
  if (!env.APP_TOKEN) console.log("Warning: APP_TOKEN is not set, so the API is open to anyone who can reach this port.");
});
