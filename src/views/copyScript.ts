// The card's only script: the Copy button for the party's link. A plain
// string inlined right after the field, not a module: the browser runs no
// React and loads nothing else. The field stays selectable, so the page works
// without it.
import { messages } from "./messages.js";

// The wording goes in through JSON.stringify, so a quote in it can't break
// the script.
export const copyScript = `(() => {
  const button = document.getElementById("copy-link");
  const field = document.getElementById("party-link");
  const status = document.getElementById("copy-status");
  if (!button || !field || !status) return;
  // Runs as soon as the field is parsed, before the first paint, so making
  // room for the icon never shifts the link the diner is reading.
  button.parentElement.dataset.copy = "on";
  button.hidden = false;
  let reset;
  button.addEventListener("click", async () => {
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
