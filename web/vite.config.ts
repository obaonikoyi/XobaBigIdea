import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Xoba Big Idea",
        short_name: "Big Idea",
        description: "Speak it. Save it. Come back to it.",
        theme_color: "#c2410c",
        background_color: "#fbf8f3",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // App shell works offline. API calls always go to the network.
        globPatterns: ["**/*.{js,css,html,svg}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8787" } },
  preview: { proxy: { "/api": "http://localhost:8787" } },
});
