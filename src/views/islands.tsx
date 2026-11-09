// The card page's two islands. Each is a custom element, defined by one
// dependency-free script in browser/, that finds everything it uses inside
// itself and takes its settings from its own attributes, and that the browser
// sets up whenever it's added to the page: on load, or inside a card the live
// update swaps in. Without JavaScript an island is a plain wrapper, and the
// page works as it is.
//
// An island brings its own script: rendering its element is all it takes.
// toHtml (html.ts) puts the script of each island a page shows in that page's
// <head>, so no page lists the scripts it needs.
import type { ReactNode } from "react";
import { copyLinkJs, liveCardJs } from "./browserFiles.js";

// Custom elements, so React's JSX knows their attributes.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "live-card": { src: string; children: ReactNode };
      "copy-link": { children: ReactNode };
    }
  }
}

// Each island's element and the script that defines it.
const islandScripts = {
  "live-card": liveCardJs,
  "copy-link": copyLinkJs,
} as const;

/**
 * The scripts of the islands in this rendered HTML, as one <script>, or ""
 * when it shows none. A diner's text can't pass for an element: React
 * escapes its "<".
 */
export function scriptsFor(html: string): string {
  const scripts = Object.entries(islandScripts)
    .filter(([tag]) => new RegExp(`<${tag}[\\s>]`).test(html))
    .map(([, script]) => script);
  return scripts.length === 0 ? "" : `<script>${scripts.join("\n")}</script>`;
}

/**
 * Keeps the card inside it up to date while the page is open, fetching it
 * from `src`. The card at `src` is the card alone, swapped in inside.
 */
export function LiveCard({
  src,
  children,
}: {
  src: string;
  children: ReactNode;
}) {
  return <live-card src={src}>{children}</live-card>;
}

/**
 * The Copy button for the link's field inside it: the field, the button and
 * the status that announces the copy.
 */
export function CopyLink({ children }: { children: ReactNode }) {
  return <copy-link>{children}</copy-link>;
}
