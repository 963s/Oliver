import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * PWA: workbox's internal Rollup+Terser step can hang in some toolchains. Using
 * `workbox.mode: "development"` skips the Terser minify pass while keeping a valid SW.
 * Main app bundle uses esbuild minify (Vite default when set below).
 */
export default defineConfig({
  /** Required for Tauri production bundles (relative asset URLs in the webview). */
  base: "./",
  build: {
    minify: "esbuild",
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Avoid @rollup/plugin-terser in workbox-build "bundle" step (hang / early exit on some envs)
        mode: "development",
        navigateFallback: "index.html",
      },
      manifest: {
        name: "Oliver Roos Frisuren",
        short_name: "Roos",
        display: "standalone",
        start_url: "/",
        background_color: "#050505",
        theme_color: "#050505",
        icons: [],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
});
