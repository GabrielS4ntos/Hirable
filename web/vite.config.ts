import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 4322,
    // Dev server proxies the API to the local agent server.
    proxy: { "/api": { target: "http://127.0.0.1:4321", changeOrigin: true } }
  }
});
