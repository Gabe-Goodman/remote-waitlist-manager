// <copy-link>: the Copy button for the party's link. An island: it holds the
// link's field, the button and the status it announces, and finds them inside
// itself, so it works wherever it's put, including in a card the live update
// swaps in later, because the browser sets up every <copy-link> as it's added
// to the page. src/views/islands.tsx inlines this file into the card page's
// <head>; it isn't served at a URL of its own. Without JavaScript it's a
// plain wrapper: the field stays selectable, and the stylesheet shows the
// button only once the element is defined.
(() => {
  class CopyLink extends HTMLElement {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    #reset;

    constructor() {
      super();
      // On the element itself, so the listener goes wherever it goes.
      this.addEventListener("click", (event) => void this.#copy(event));
    }

    disconnectedCallback() {
      clearTimeout(this.#reset);
    }

    /** @param {MouseEvent} event */
    async #copy(event) {
      const button =
        event.target instanceof Element ? event.target.closest("button") : null;
      const field = this.querySelector("input");
      const status = this.querySelector('[role="status"]');
      if (!button || !field || !(status instanceof HTMLElement)) return;
      try {
        await navigator.clipboard.writeText(field.value);
      } catch {
        // navigator.clipboard only exists on secure pages, so a phone
        // reaching the app over plain HTTP on the local network copies the
        // old way.
        field.select();
        document.execCommand("copy");
      }
      this.dataset.copied = "";
      // The wording comes from the page (messages.ts), not from this file.
      status.textContent = status.dataset.copiedText ?? "";
      clearTimeout(this.#reset);
      // Long enough to notice at a glance, short enough to copy again.
      this.#reset = setTimeout(() => {
        delete this.dataset.copied;
        status.textContent = "";
      }, 2000);
    }
  }

  customElements.define("copy-link", CopyLink);
})();
