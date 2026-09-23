import { defineConfig } from "@playwright/test";

// Two servers: one with (fake) AI, one with AI switched off. Both serve the built app.
const server = (port: number, ai: string, dir: string) =>
  `rm -rf ${dir} && DATA_DIR=${dir} PORT=${port} AI_PROVIDER=${ai} TRANSCRIBE_PROVIDER=${ai} WEB_DIST=dist node --import tsx ../server/src/node.ts`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    permissions: ["microphone"],
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: [
    { command: server(8790, "fake", "../.e2e-data/ai"), url: "http://localhost:8790/api/ping", reuseExistingServer: false, stdout: "pipe" },
    { command: server(8791, "none", "../.e2e-data/noai"), url: "http://localhost:8791/api/ping", reuseExistingServer: false, stdout: "pipe" },
  ],
});
