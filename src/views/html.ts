// Turns a page, or a piece of one, into the HTML sent to the browser. No
// HTTP here.
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { scriptsFor } from "./islands.js";

// A page gets the script of each island its body shows, at the end of its
// <head>: it runs before the body is read, so each island is set up as the
// browser reaches it and nothing on screen shifts. Only the body is looked
// at: the <head>'s inlined stylesheet mentions the islands in its comments.
export function toHtml(page: ReactElement): string {
  const html = renderToString(page);
  const body = html.slice(html.indexOf("<body"));
  return (
    "<!DOCTYPE html>" + html.replace("</head>", `${scriptsFor(body)}</head>`)
  );
}

// No doctype: a piece is swapped into a page that already has one.
export function toFragment(piece: ReactElement): string {
  return renderToString(piece);
}
