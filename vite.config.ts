// Builds the browser side: the islands that hydrate on the party page. The
// server still renders every page; this bundle only adds behaviour to it.
// `npm run build` runs it after tsc; the output is served from /assets.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/browser",
    emptyOutDir: true,
    rollupOptions: {
      input: "browser/islands.tsx",
      // A fixed name: the server adds a content hash to the URL itself.
      output: { entryFileNames: "islands.js" },
    },
  },
});
