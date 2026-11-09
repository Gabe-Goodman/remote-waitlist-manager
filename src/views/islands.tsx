// The card page's two islands. Each is a custom element, defined by one
// dependency-free script in browser/, that finds everything it uses inside
// itself and takes its settings from its own attributes, and that the browser
// sets up whenever it's added to the page: on load, or inside a card the live
// update swaps in. Without JavaScript an island is a plain wrapper, and the
// page works as it is.
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

/** The script that defines both islands, for the <head> of a page that shows them. */
export const islandsJs = `${copyLinkJs}\n${liveCardJs}`;

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
