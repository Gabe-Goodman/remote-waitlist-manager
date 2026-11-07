// Turns a page into the HTML document sent to the browser. No HTTP here.
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

export function toHtml(page: ReactElement): string {
  return "<!DOCTYPE html>" + renderToString(page);
}
