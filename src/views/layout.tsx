// The HTML shell every page shares: phone-sized and readable. The scripts of
// the islands a page shows are added to its <head> by toHtml (html.ts), and
// every page works without them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { pageCss } from "./browserFiles.js";

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
  children,
}: {
  title: string;
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
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
