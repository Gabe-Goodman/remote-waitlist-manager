// The party's current state: waiting (with its place in the queue), ready
// (with the Check-in button), checked in, or done or left (with a link to
// join again); its name and size; while it still has a place, its
// link, ready to copy; and, while it's still in the queue, a way to leave.
// Renders only: the route passes in the state and the site's origin. The
// server renders it into the page, and browser/liveCard.tsx renders it again
// in the browser as the card changes.
import { useEffect, useRef, useState } from "react";
import type { Party, PartyState } from "../domain/waitlist.js";
import { cardTitles, messages } from "./messages.js";

// Everything the card shows, and nothing else: the browser gets this on the
// page and as JSON for the live card, so the party's email and join key
// never leave the server.
export type CardData = {
  party: Pick<Party, "token" | "name" | "size">;
  state: PartyState;
  origin: string;
};

export function cardData(
  party: Party,
  state: PartyState,
  origin: string,
): CardData {
  const { token, name, size } = party;
  return { party: { token, name, size }, state, origin };
}

// origin: the site's address as the diner reached it, so the link works
// when opened on another phone.
export function PartyCard({ party, state, origin }: CardData) {
  const placeGone = state.kind === "done" || state.kind === "left";
  const inQueue = state.kind === "waiting" || state.kind === "ready";
  return (
    // data-state lets the live update tell the states apart without
    // reading the wording; data-title gives it the tab's title.
    <section
      className="card"
      data-state={state.kind}
      data-title={cardTitles[state.kind]}
    >
      <h1>{cardTitles[state.kind]}</h1>
      {/* Where you stand comes first and largest: it's what a diner looks
          for every time they glance at their phone. */}
      <div className="place">
        <StateLine state={state} />
        <p>{messages.partyLine(party.name, party.size)}</p>
      </div>
      {/* A link, not a button, so nobody joins again the same evening by
          accident. */}
      {placeGone && (
        <p className="join-again">
          <a href={`/?rejoin=${party.token}`}>{messages.joinAgain}</a>
        </p>
      )}
      {/* The page's only filled button, so the one thing to do now is the
          one that stands out. */}
      {state.kind === "ready" && (
        <form method="post" action={`/party/${party.token}/check-in`}>
          <button type="submit">{messages.checkInButton}</button>
        </form>
      )}
      {/* A party that finished or left has no place left
          to share. */}
      {!placeGone && <ShareLink link={`${origin}/party/${party.token}`} />}
      {inQueue && <LeaveControl partyToken={party.token} />}
    </section>
  );
}

function StateLine({ state }: { state: PartyState }) {
  switch (state.kind) {
    case "waiting":
      return <p className="ahead">{messages.ahead(state.ahead)}</p>;
    case "ready":
      // No time limit: the table is held until the party checks in or
      // leaves.
      return <p className="ahead">{messages.checkInNow}</p>;
    case "in-service":
      // The service is timed on the server, and the card turns to "Thanks"
      // on its own when it ends.
      return <p className="ahead">{messages.enjoyMeal}</p>;
    case "done":
    case "left":
      return null;
  }
}

// Leaving can't be undone, so it takes a second, deliberate tap: the summary
// opens the warning and the button, and tapping it again closes them, which
// is how a diner stays. A native <details> does this without a page of its
// own or any script. Last on the card and quiet, so it never competes with
// the Check-in button.
function LeaveControl({ partyToken }: { partyToken: string }) {
  return (
    <details className="leave">
      <summary>{messages.leave}</summary>
      <p>{messages.leaveWarning}</p>
      <form method="post" action={`/party/${partyToken}/leave`}>
        {/* TableKit's danger button is outlined in red, not filled: it
            warns, and it stays quieter than the Check-in button. */}
        <button type="submit" data-variant="danger">
          {messages.leaveButton}
        </button>
      </form>
    </details>
  );
}

// The cookie only remembers the party in this browser; the link carries it
// to another phone or to the group. Tapping a link here would just reload
// this page, so the card shows the address itself, ready to copy, and says
// who can use it.
function ShareLink({ link }: { link: string }) {
  return (
    <div className="share">
      <label htmlFor="party-link">{messages.partyLinkLabel}</label>
      <CopyField link={link} />
      <p id="party-link-hint" className="secondary">
        {messages.partyLinkHint}
      </p>
    </div>
  );
}

// The link's field, with a Copy button inside it, so showing the button
// moves nothing. The button appears only once the browser has taken over the
// card: without JavaScript it would do nothing. The server and the browser's
// first render both leave it out, so they match.
function CopyField({ link }: { link: string }) {
  const [interactive, setInteractive] = useState(false);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => setInteractive(true), []);
  // Long enough to notice at a glance, short enough to copy again.
  useEffect(() => {
    if (!copied) return;
    const reset = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(reset);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // navigator.clipboard only exists on secure pages, so a phone reaching
      // the app over plain HTTP on the local network copies the old way.
      field.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
  }

  return (
    <div className="copy-field">
      <input
        ref={field}
        id="party-link"
        readOnly
        value={link}
        aria-describedby="party-link-hint"
        data-stretch
      />
      {/* "custom" opts it out of TableKit's filled button: it's an icon. */}
      {interactive && (
        <button
          type="button"
          className="custom"
          aria-label={messages.copyLink}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
      <span role="status" className="visually-hidden">
        {copied ? messages.copiedLink : ""}
      </span>
    </div>
  );
}

// Drawn here rather than taken from an icon library: two shapes don't
// justify a dependency. currentColor follows the button's colour.
function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
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
