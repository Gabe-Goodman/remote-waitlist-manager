// The HTML shell every page shares: phone-sized and readable. A page may
// ask for the islands script; only the party page does, for its Copy button
// and its live card, and every page works without it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { islandsVersion, pageCss } from "./browserFiles.js";

// TableKit's classless stylesheet, inlined into every page rather than
// linked: on a slow phone connection a linked stylesheet is a second request
// that holds up the first paint (about 1.3 s against 0.7 s on Slow 4G).
// Read once, when the app starts; the text never changes while it runs.
const tablekitCss = readFileSync(
  createRequire(import.meta.url).resolve(
    "@tablecheck/tablekit-css/tablekit.classless.min.css",
  ),
  "utf8",
);

export function Layout({
  title,
  islands = false,
  children,
}: {
  title: string;
  islands?: boolean;
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {/* TableKit first: the page's own rules below win where their
            selectors are as specific as TableKit's. */}
        <style>{tablekitCss}</style>
        <style>{pageCss}</style>
        {/* A module script waits for the page to be parsed, so it can sit
            in the <head> and start downloading at once. */}
        {islands && (
          <script
            type="module"
            src={`/assets/islands.js?v=${islandsVersion}`}
          />
        )}
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
