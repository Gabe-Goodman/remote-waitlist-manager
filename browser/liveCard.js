// Keeps the party's card up to date while the page is open, so a diner never
// has to reload. src/views/waitlistPage.tsx inlines this file into the card
// page's <head>; it isn't served at a URL of its own. Without JavaScript the
// page still shows the right state on every load.
//
// The loop: every 2 seconds, fetch the card from GET /card, one request at a
// time. If it changed, put the new card on screen. If the fetch fails, keep
// the card already shown. When the page becomes visible again (a phone taken
// out of a pocket), fetch at once. Once the card can't change any more (done,
// left or out of time), stop.
//
// The countdown: every second, show the time left to check in ("0:42 left")
// until the deadline in the card's <time>. At 0:00, fetch the card at once
// rather than waiting for the next poll.
(() => {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let fetching = false;
  // The deadline already refetched for at 0:00, so it happens once.
  let refetchedFor = "";
  // These cards stay as they are: nothing left to poll for.
  const finalStates = ["done", "left", "expired"];

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
      else if (response.ok) showCard(await response.text());
    } catch {
      // A flaky connection keeps the last known card rather than an error;
      // the next try may get through.
    } finally {
      fetching = false;
      if (keepGoing && !cardIsFinal()) timer = setTimeout(refresh, 2000);
    }
  }

  /** @param {string} html the card as the server rendered it */
  function showCard(html) {
    const oldCard = document.querySelector("section.card");
    const newCard = cardFrom(html);
    if (!(oldCard instanceof HTMLElement) || !newCard) return;
    // The server sends the countdown empty; fill it first, so a card that
    // only differs by the ticking text counts as unchanged.
    showTimeLeft(newCard);
    // Most polls bring the same card: leave the page alone, so nothing
    // flickers and nothing the diner is reading or selecting is lost.
    if (newCard.outerHTML === oldCard.outerHTML) return;

    const leaveWasOpen = isLeaveOpen(oldCard);
    const wasReady = oldCard.dataset.state === "ready";
    oldCard.replaceWith(newCard);

    if (leaveWasOpen) openLeave(newCard);
    // The card carries its own title (from messages.ts), so the tab shows
    // the same words as the card.
    if (newCard.dataset.title) document.title = newCard.dataset.title;
    if (newCard.dataset.state === "ready" && !wasReady) vibrate();
  }

  // Fills in "m:ss left", rounded down, from the deadline on the card and the
  // phone's clock. Returns the time left, or undefined for a card without a
  // countdown.
  /** @param {Element} card */
  function showTimeLeft(card) {
    const deadline = card.querySelector(".ahead time");
    const line = card.querySelector(".countdown");
    if (!deadline || !line) return undefined;
    const msLeft =
      Date.parse(deadline.getAttribute("datetime") ?? "") - Date.now();
    const seconds = Math.max(0, Math.floor(msLeft / 1000));
    const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
    if (line.textContent !== text) line.textContent = text;
    return msLeft;
  }

  function tick() {
    const card = document.querySelector("section.card");
    if (!card) return;
    const msLeft = showTimeLeft(card);
    const deadline = card
      .querySelector(".ahead time")
      ?.getAttribute("datetime");
    // Time's up: the card is about to change to "ran out", so ask now.
    if (
      msLeft !== undefined &&
      msLeft <= 0 &&
      deadline &&
      deadline !== refetchedFor
    ) {
      refetchedFor = deadline;
      void refresh();
    }
  }

  function cardIsFinal() {
    const card = document.querySelector("section.card");
    return (
      card instanceof HTMLElement &&
      finalStates.includes(card.dataset.state ?? "")
    );
  }

  // Turns the HTML text into an element without showing it: a <template>
  // builds its content off screen.
  /** @param {string} html */
  function cardFrom(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const card = template.content.firstElementChild;
    return card instanceof HTMLElement ? card : undefined;
  }

  // "Leave the waitlist" is a <details> element: open while the diner reads
  // the warning, maybe about to tap "Yes, leave".
  /** @param {HTMLElement} card */
  function isLeaveOpen(card) {
    const leave = card.querySelector("details.leave");
    return leave instanceof HTMLDetailsElement && leave.open;
  }

  // A new card arrives with it closed; reopening it means the swap never
  // snaps it shut under the diner's finger.
  /** @param {HTMLElement} card */
  function openLeave(card) {
    const leave = card.querySelector("details.leave");
    if (leave instanceof HTMLDetailsElement) leave.open = true;
  }

  // Browsers allow vibration only after the diner has tapped the page, and
  // iPhones don't vibrate at all; the card and the title still change.
  function vibrate() {
    try {
      navigator.vibrate?.(200);
    } catch {
      // Nothing to do: the card and the title are the main signal.
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !cardIsFinal()) {
      void refresh();
    }
  });
  // This script runs in the <head>, before the card exists, so it starts
  // once the page has loaded: the countdown at once and every second, and
  // the polling only if the card can still change.
  document.addEventListener("DOMContentLoaded", () => {
    tick();
    setInterval(tick, 1000);
    if (!cardIsFinal()) timer = setTimeout(refresh, 2000);
  });
})();
