// The card page's only script: the Copy button for the party's link. A plain
// string inlined into the page's <head>, not a module: the browser runs no
// React and loads nothing else. It lives on the page rather than in the
// card, because a card swapped in later never runs a script of its own. The
// field stays selectable, so the page works without it.
import { messages } from "./messages.js";

// The wording goes in through JSON.stringify, so a quote in it can't break
// the script.
export const copyScript = `(() => {
  // Set in the <head>, before the body is drawn: the stylesheet shows the
  // icon and makes room for it only under this class, so the link the diner
  // is reading never shifts, and every card swapped in later gets the icon
  // too. Without JavaScript there is no icon and no empty gap.
  document.documentElement.classList.add("js");
  let reset;
  // One listener on the document, not on the button: it keeps working when
  // the card, button included, is replaced.
  document.addEventListener("click", async (event) => {
    const button =
      event.target instanceof Element && event.target.closest("#copy-link");
    const field = document.getElementById("party-link");
    const status = document.getElementById("copy-status");
    if (!button || !field || !status) return;
    try {
      await navigator.clipboard.writeText(field.value);
    } catch {
      // navigator.clipboard only exists on secure pages, so a phone reaching
      // the app over plain HTTP on the local network copies the old way.
      field.select();
      document.execCommand("copy");
    }
    button.parentElement.dataset.copied = "";
    status.textContent = ${JSON.stringify(messages.copiedLink)};
    clearTimeout(reset);
    // Long enough to notice at a glance, short enough to copy again.
    reset = setTimeout(() => {
      delete button.parentElement.dataset.copied;
      status.textContent = "";
    }, 2000);
  });
})();`;
