// Turns a page, or a piece of one, into the HTML sent to the browser. No
// HTTP here.
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

export function toHtml(page: ReactElement): string {
  return "<!DOCTYPE html>" + renderToString(page);
}

// No doctype: a piece is swapped into a page that already has one.
export function toFragment(piece: ReactElement): string {
  return renderToString(piece);
}
