// The party's current state: waiting (with its place in the queue), ready
// (with the Check-in button), checked in, or done; its name and size; and,
// while it still has a place, its link, ready to copy. Renders only: the
// route passes in the state and the site's origin.
import type { Party, PartyState } from "../domain/waitlist.js";
import { copyScript } from "./copyScript.js";
import { cardTitles, messages } from "./messages.js";

// origin: the site's address as the diner reached it, so the link works
// when opened on another phone.
export function PartyCard({
  party,
  state,
  origin,
}: {
  party: Party;
  state: PartyState;
  origin: string;
}) {
  return (
    <section className="card">
      <h1>{cardTitles[state.kind]}</h1>
      {/* Where you stand comes first and largest: it's what a diner looks
          for every time they glance at their phone. */}
      <div className="place">
        <StateLine state={state} />
        <p>{messages.partyLine(party.name, party.size)}</p>
      </div>
      {/* The page's only filled button, so the one thing to do now is the
          one that stands out. */}
      {state.kind === "ready" && (
        <form method="post" action="/check-in">
          <button type="submit">{messages.checkInButton}</button>
        </form>
      )}
      {/* A finished party has nothing left for anyone to see or do. */}
      {state.kind !== "done" && (
        <ShareLink link={`${origin}/party/${party.token}`} />
      )}
    </section>
  );
}

function StateLine({ state }: { state: PartyState }) {
  switch (state.kind) {
    case "waiting":
      return <p className="ahead">{messages.ahead(state.ahead)}</p>;
    case "ready":
      return <p className="ahead">{messages.checkInNow}</p>;
    case "in-service":
      return <p className="ahead">{messages.enjoyMeal}</p>;
    case "done":
      return null;
  }
}

// The cookie only remembers the party in this browser; the link carries it
// to another phone or to the group. Tapping a link here would just reload
// this page, so the card shows the address itself, ready to copy, and says
// who can use it.
function ShareLink({ link }: { link: string }) {
  return (
    <div className="share">
      <label htmlFor="party-link">{messages.partyLinkLabel}</label>
      {/* The Copy button sits inside the field, so turning it on moves
          nothing. Rendered hidden: without JavaScript it would do nothing.
          "custom" opts it out of TableKit's filled button: it's an icon. */}
      <div className="copy-field">
        <input
          id="party-link"
          readOnly
          value={link}
          aria-describedby="party-link-hint"
          data-stretch
        />
        <button
          type="button"
          id="copy-link"
          className="custom"
          aria-label={messages.copyLink}
          hidden
        >
          <CopyIcon />
          <CheckIcon />
        </button>
        <span role="status" id="copy-status" className="visually-hidden" />
      </div>
      <script>{copyScript}</script>
      <p id="party-link-hint" className="secondary">
        {messages.partyLinkHint}
      </p>
    </div>
  );
}

// Drawn here rather than taken from an icon library: two shapes don't
// justify a dependency. currentColor follows the button's colour.
function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon-copy"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon-check"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
