// The HTML shell every page shares: phone-sized, readable, no scripts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ReactNode } from "react";

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

// TableKit styles the elements; these rules only lay out the page and keep
// what TableKit doesn't.
const styles = `
  /* TableKit colours the text but not the page: without this, a phone in
     dark mode gets light text on a white page. */
  body { background: var(--surface); }
  main { max-width: 30rem; margin: 0 auto; padding: var(--spacing-l6) var(--spacing-l5); }
  /* TableKit's reset removes every margin and leaves the rhythm to the page:
     8px inside a group, 24px between groups. */
  h1 + * { margin-top: var(--spacing-l2); }
  p + p { margin-top: var(--spacing-l2); }
  form, .place { margin-top: var(--spacing-l5); }
  form > :first-child { margin-top: 0; }
  label { display: block; margin-top: var(--spacing-l4); }
  button { width: 100%; margin-top: var(--spacing-l5); }
  .secondary { color: var(--text-subtle); }
  /* Fields at 16px or more, so phones don't zoom in when one is tapped:
     TableKit's small fields are 14px. */
  input, select { font-size: 1rem; }
  /* TableKit's alert is a fixed 345px; the notice spans the form instead. */
  .alert { width: auto; }
  /* Plain red text, not TableKit's filled input alert: with several fields
     wrong at once, one box at the top is enough. --error follows dark mode. */
  .field-error { color: var(--error); margin-top: var(--spacing-l1); }
  /* The one emphasis: where you stand, in a quiet TableKit panel. */
  .place { background: var(--neutral-surface); border: 1px solid var(--border);
    border-radius: var(--border-radius-small); padding: var(--spacing-l4); }
  .ahead { font: var(--h2); }
`;

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
        <style>{styles}</style>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
