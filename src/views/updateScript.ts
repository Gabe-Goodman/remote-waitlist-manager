// The card page's live update: the card follows the party's state while the
// page is open, so a diner never has to reload. A plain string inlined into
// the page's <head>, like the Copy script. Without JavaScript the page still
// shows the right state on every load.
import { cardTitles } from "./messages.js";

// The titles go in through JSON.stringify, so a quote in them can't break
// the script.
export const updateScript = `(() => {
  const titles = ${JSON.stringify(cardTitles)};
  let timer;
  let fetching = false;

  // One request at a time: the next is scheduled only once this one has
  // finished, so a slow connection never stacks requests.
  async function refresh() {
    clearTimeout(timer);
    if (fetching) return;
    fetching = true;
    let keepGoing = true;
    try {
      const response = await fetch("/card", { cache: "no-store" });
      // No party any more: there is no card to keep up to date.
      if (response.status === 204) keepGoing = false;
      else if (response.ok) swap(await response.text());
    } catch {
      // A flaky connection keeps the last known card rather than an error;
      // the next try may get through.
    } finally {
      fetching = false;
      if (keepGoing) timer = setTimeout(refresh, 2000);
    }
  }

  function swap(html) {
    const card = document.querySelector("section.card");
    const template = document.createElement("template");
    template.innerHTML = html;
    const next = template.content.firstElementChild;
    // Compared as the browser writes both, and swapped only on a change: no
    // flicker, and nothing the diner is reading or selecting is lost.
    if (!card || !next || next.outerHTML === card.outerHTML) return;
    const leaveWasOpen = card.querySelector("details.leave")?.open;
    const wasReady = card.dataset.state === "ready";
    card.replaceWith(next);
    if (leaveWasOpen) {
      const leave = next.querySelector("details.leave");
      if (leave) leave.open = true;
    }
    const state = next.dataset.state;
    if (titles[state]) document.title = titles[state];
    if (state === "ready" && !wasReady) {
      // Browsers allow vibration only after the diner has tapped the page,
      // and iPhones don't vibrate at all; the title and the card still change.
      try {
        navigator.vibrate?.(200);
      } catch {}
    }
  }

  // A phone taken out of a pocket shows the current state at once.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  timer = setTimeout(refresh, 2000);
})();`;
