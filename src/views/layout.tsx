// The HTML shell every page shares: phone-sized and readable. The only
// script is the party card's, for its Copy button; every page works
// without it.
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
  form, .place, .share { margin-top: var(--spacing-l5); }
  form > :first-child { margin-top: 0; }
  label { display: block; margin-top: var(--spacing-l4); }
  button { width: 100%; margin-top: var(--spacing-l5); }
  .secondary { color: var(--text-subtle); }
  /* Fields at 16px or more, so phones don't zoom in when one is tapped:
     TableKit's small fields are 14px. */
  input, select { font-size: 1rem; }
  /* TableKit's alert is a fixed 345px; the notice spans the form instead. */
  .alert { width: auto; }
  /* A notice above the card is its own group: the card's heading has no
     margin of its own to keep it off the box. */
  .alert + .card { margin-top: var(--spacing-l5); }
  /* Plain red text, not TableKit's filled input alert: with several fields
     wrong at once, one box at the top is enough. --error follows dark mode. */
  .field-error { color: var(--error); margin-top: var(--spacing-l1); }
  /* The one emphasis: where you stand, in a quiet TableKit panel. */
  .place { background: var(--neutral-surface); border: 1px solid var(--border);
    border-radius: var(--border-radius-small); padding: var(--spacing-l4); }
  .ahead { font: var(--h2); }
  /* The hint sits close under the field it explains, a size smaller than
     the page's text, so it reads as a note. Inset like the field's text on
     both sides, so it lines up with the link it describes. */
  #party-link-hint { margin-top: var(--spacing-l1); font: var(--body-2);
    padding-inline: var(--spacing-l3); }
  /* The Copy icon sits inside the link's field at its right edge. Only once
     the script has shown it does the field make room, so without JavaScript
     there is no empty gap. */
  .copy-field { position: relative; }
  /* By id: TableKit's padding rule on inputs is more specific than a class. */
  .copy-field[data-copy="on"] #party-link { padding-right: 2.5rem; }
  /* A long link ends in "…" rather than a character cut in half. */
  #party-link { text-overflow: ellipsis; }
  /* A 40px tap target, more specific than the page-wide button rule. */
  .copy-field button { position: absolute; right: 0.125rem; top: 50%;
    transform: translateY(-50%); width: 2.5rem; height: 2.5rem; margin-top: 0;
    display: flex; align-items: center; justify-content: center;
    background: none; color: var(--text-subtle); cursor: pointer;
    border-radius: var(--border-radius-small); }
  /* Its display: flex would otherwise beat the hidden attribute. */
  .copy-field button[hidden] { display: none; }
  .copy-field .icon-check, .copy-field[data-copied] .icon-copy { display: none; }
  .copy-field[data-copied] .icon-check { display: block; }
  /* Read out by screen readers, never shown. */
  .visually-hidden { position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
