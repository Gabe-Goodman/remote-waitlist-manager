// The files in browser/, read once when the app starts. The CSS and scripts
// are inlined into the pages: one request is faster than two on a slow phone
// connection. Paths are relative to the project folder, where the app always
// starts. Reads files only: no rendering here.
import { readFileSync } from "node:fs";

function browserFile(name: string): string {
  return readFileSync(`browser/${name}`, "utf8");
}

export const pageCss = browserFile("page.css");
export const copyLinkJs = browserFile("copyLink.js");
export const liveCardJs = browserFile("liveCard.js");

// The restaurant's icon, served at its own address rather than inlined:
// browsers and Apple's link previews fetch it by URL. Carbon's knife and fork
// (see icons.tsx) in white on TableKit's --purple-600, 180 × 180 and square,
// since iOS rounds the corners itself.
export const appIconPng = readFileSync("browser/apple-touch-icon.png");
