import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// RagGen studio SPA.
//
// Two ways to run it:
//   1. Production / "just run the tool": `npm run build` at the repo root emits into
//      ../public/video-generator and Next serves it at /video-generator (see next.config.js).
//   2. SPA hot-reload: `npm run web:dev` serves it on :5177 and proxies /api/* to the Next
//      API on :3100 (start that with `npm run dev`), so the SPA's same-origin fetches work.
//
// `base` stays "/video-generator/" to match the app's React Router basename.

function frameAncestors(env: Record<string, string>): string {
  const fromList = (env.VITE_FRAME_ANCESTORS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const ancestors = new Set<string>(["'self'"]);
  fromList.forEach((o) => ancestors.add(o));
  return Array.from(ancestors).join(" ");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:3101";
  const headers = {
    "Content-Security-Policy": `frame-ancestors ${frameAncestors(env)};`,
  };
  return {
    envDir: "..",
    base: "/video-generator/",
    plugins: [react()],
    build: {
      // Emit into the Next app's public/ so it is served at /video-generator/.
      outDir: "../public/video-generator",
      emptyOutDir: true,
    },
    server: {
      port: 5177,
      headers,
      proxy: { "/api": { target: apiTarget, changeOrigin: true } },
    },
    preview: {
      port: 5177,
      headers,
      proxy: { "/api": { target: apiTarget, changeOrigin: true } },
    },
  };
});
