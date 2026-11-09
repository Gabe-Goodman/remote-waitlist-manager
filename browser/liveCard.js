// <live-card src="/party/<token>/card">: keeps the party's card inside it up
// to date while the page is open, so a diner never has to reload. An island:
// it works only on what's its own (the card inside it, the address in its
// src), and the browser starts it when it's added to the page and stops it
// when it's removed. src/views/islands.tsx inlines this file into the card
// page's <head>; it isn't served at a URL of its own. Without JavaScript it's
// a plain wrapper, and the page shows the right state on every load.
//
// The loop: every 2 seconds, fetch the card from src, one request at a time.
// If it differs from the last card the server sent, put the new card in
// place of the old one. If the fetch fails, keep the card already shown.
// When the page becomes visible again (a phone taken out of a pocket), fetch
// at once. Once the card can't change any more (done or left), stop.
(() => {
  // These cards stay as they are: nothing left to poll for.
  const finalStates = ["done", "left"];

  class LiveCard extends HTMLElement {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    #timer;
    #fetching = false;
    // The last card the server sent, which each new one is compared with.
    // Not the card in the page: the diner (opening Leave) or a browser
    // extension (marking the link's field) changes that, and the card would
    // be swapped every 2 seconds, ringing the bell each time.
    /** @type {string | undefined} */
    #lastCard;

    #start = () => {
      this.#lastCard = this.#card()?.outerHTML;
      this.#schedule();
    };
    #onVisible = () => {
      if (document.visibilityState === "visible") void this.#refresh();
    };

    connectedCallback() {
      document.addEventListener("visibilitychange", this.#onVisible);
      // This script runs in the <head>, so the browser sets the element up
      // as soon as it reads its start tag, before the card inside it exists:
      // start once the page has loaded.
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", this.#start, {
          once: true,
        });
      } else {
        this.#start();
      }
    }

    disconnectedCallback() {
      document.removeEventListener("visibilitychange", this.#onVisible);
      document.removeEventListener("DOMContentLoaded", this.#start);
      clearTimeout(this.#timer);
    }

    // The next fetch in 2 seconds, unless the card can't change any more.
    #schedule() {
      clearTimeout(this.#timer);
      if (this.isConnected && !this.#isFinal()) {
        this.#timer = setTimeout(() => void this.#refresh(), 2000);
      }
    }

    // One request at a time: the next is scheduled only once this one has
    // finished, so a slow connection never stacks requests.
    async #refresh() {
      clearTimeout(this.#timer);
      const src = this.getAttribute("src");
      if (this.#fetching || !src || this.#isFinal()) return;
      this.#fetching = true;
      let keepGoing = true;
      try {
        const response = await fetch(src, { cache: "no-store" });
        // No party any more: there is no card to keep up to date.
        if (response.status === 204) keepGoing = false;
        else if (response.ok) this.#show(await response.text());
      } catch {
        // A flaky connection keeps the last known card rather than an error;
        // the next try may get through.
      } finally {
        this.#fetching = false;
        if (keepGoing) this.#schedule();
      }
    }

    /** @param {string} html the card as the server rendered it */
    #show(html) {
      const oldCard = this.#card();
      const newCard = cardFrom(html);
      if (!oldCard || !newCard) return;
      // Most polls bring the same card: leave the page alone, so nothing
      // flickers and nothing the diner is reading or selecting is lost.
      if (newCard.outerHTML === this.#lastCard) return;
      this.#lastCard = newCard.outerHTML;

      const leaveWasOpen = isLeaveOpen(oldCard);
      const wasReady = oldCard.dataset.state === "ready";
      oldCard.replaceWith(newCard);

      if (leaveWasOpen) openLeave(newCard);
      // The tab shows the card's title (from messages.ts), so the card keeps
      // it in step.
      if (newCard.dataset.title) document.title = newCard.dataset.title;
      if (newCard.dataset.state === "ready" && !wasReady) vibrate();
    }

    #card() {
      const card = this.querySelector(":scope > section.card");
      return card instanceof HTMLElement ? card : undefined;
    }

    #isFinal() {
      return finalStates.includes(this.#card()?.dataset.state ?? "");
    }
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

  customElements.define("live-card", LiveCard);
})();
