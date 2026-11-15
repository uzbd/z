import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.BASE_PATH || "./",
  worker: { format: "es" },
  plugins: [
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Smart Text Decoder",
        short_name: "Decoder",
        description: "Decode and encode scrambled text, live and offline.",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        runtimeCaching: [{ urlPattern: /\/(?:common-)?words\.txt$/, handler: "CacheFirst", options: { cacheName: "dictionary" } }]
      }
    })
  ]
});
