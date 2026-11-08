// The files in browser/, read once when the app starts and inlined into the
// pages: one request is faster than two on a slow phone connection. Paths are
// relative to the project folder, where the app always starts. Reads files
// only: no rendering here.
import { readFileSync } from "node:fs";

function browserFile(name: string): string {
  return readFileSync(`browser/${name}`, "utf8");
}

export const pageCss = browserFile("page.css");
export const copyLinkJs = browserFile("copyLink.js");
export const liveCardJs = browserFile("liveCard.js");
