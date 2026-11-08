// The page's own CSS: a handful of layout rules on top of TableKit's
// stylesheet. A string in a module rather than a .css file, so it ships
// inside the compiled code with no build step to copy it.

// TableKit styles the elements; these rules only lay out the page and keep
// what TableKit doesn't.
export const pageStyles = `
  /* TableKit colours the text but not the page: without this, a phone in
     dark mode gets light text on a white page. */
  body { background: var(--surface); }
  main { max-width: 30rem; margin: 0 auto; padding: var(--spacing-l6) var(--spacing-l5); }
  /* TableKit's reset removes every margin and leaves the rhythm to the page:
     8px inside a group, 24px between groups. */
  h1 + * { margin-top: var(--spacing-l2); }
  p + p { margin-top: var(--spacing-l2); }
  form, .place, .share, .join-again, .leave { margin-top: var(--spacing-l5); }
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
  /* The Copy icon sits inside the link's field at its right edge. Only under
     the class the page's script sets is it shown and does the field make
     room, so without JavaScript there is no icon and no empty gap. */
  .copy-field { position: relative; }
  /* By id: TableKit's padding rule on inputs is more specific than a class. */
  .js .copy-field #party-link { padding-right: 2.5rem; }
  /* A long link ends in "…" rather than a character cut in half. */
  #party-link { text-overflow: ellipsis; }
  /* A 40px tap target, more specific than the page-wide button rule. */
  .copy-field button { position: absolute; right: 0.125rem; top: 50%;
    transform: translateY(-50%); width: 2.5rem; height: 2.5rem; margin-top: 0;
    display: none; align-items: center; justify-content: center;
    background: none; color: var(--text-subtle); cursor: pointer;
    border-radius: var(--border-radius-small); }
  .js .copy-field button { display: flex; }
  .copy-field .icon-check, .copy-field[data-copied] .icon-copy { display: none; }
  .copy-field[data-copied] .icon-check { display: block; }
  /* TableKit leaves <summary> unstyled; here it reads as a quiet link, like
     the card's other text links, and its warning sits close beneath it. */
  .leave summary { color: var(--link); text-decoration: underline;
    cursor: pointer; width: fit-content; }
  .leave summary + p { margin-top: var(--spacing-l2); }
  /* Read out by screen readers, never shown. */
  .visually-hidden { position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;
