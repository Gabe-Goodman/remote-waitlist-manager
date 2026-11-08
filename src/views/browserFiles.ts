// What the pages send to the browser, read once when the app starts. Paths
// are relative to the project folder, where the app always starts. Reads
// files only: no rendering here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Inlined into every page: one request is faster than two on a slow phone
// connection, and the page is styled from its first paint.
export const pageCss = readFileSync("browser/page.css", "utf8");

// The party page's script, built by Vite from browser/islands.tsx (`npm run
// build`, or `vite build --watch` under `npm run dev`). Served at its own
// address rather than inlined: it's the size of React, and a browser keeps it
// between visits, where an inlined copy would come with every page.
export const islandsJs = readFileSync("dist/browser/islands.js", "utf8");

// Part of the script's address: a new build is a new address, so a browser
// never runs an old copy it kept.
export const islandsVersion = createHash("sha256")
  .update(islandsJs)
  .digest("hex")
  .slice(0, 12);
