// The party's current state: waiting (with its place in the queue), ready
// (with the Check-in button), checked in, or done, left or out of time (with
// a link to join again); its name and size; while it still has a place, its
// link, ready to copy; and, while it's still in the queue, a way to leave.
// Renders only: the route passes in the state and the site's origin.
import {
  checkInWindowMs,
  type Party,
  type PartyState,
} from "../domain/waitlist.js";
import { toFragment } from "./html.js";
import { cardTitles, messages } from "./messages.js";

type PartyCardProps = {
  party: Party;
  state: PartyState;
  origin: string;
  timeZone: string;
};

// The card on its own, as HTML, for the live update: the same component the
// page shows, so an update can't show a card the page wouldn't.
export function cardFragment(props: PartyCardProps): string {
  return toFragment(<PartyCard {...props} />);
}

// origin: the site's address as the diner reached it, so the link works
// when opened on another phone. timeZone: the restaurant's, for the
// check-in deadline.
export function PartyCard({ party, state, origin, timeZone }: PartyCardProps) {
  const placeGone =
    state.kind === "done" || state.kind === "left" || state.kind === "expired";
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
        <StateLine state={state} timeZone={timeZone} />
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
      {/* A party that finished, left or ran out of time has no place left
          to share. */}
      {!placeGone && <ShareLink link={`${origin}/party/${party.token}`} />}
      {inQueue && <LeaveControl partyToken={party.token} />}
    </section>
  );
}

function StateLine({
  state,
  timeZone,
}: {
  state: PartyState;
  timeZone: string;
}) {
  switch (state.kind) {
    case "waiting":
      return <p className="ahead">{messages.ahead(state.ahead)}</p>;
    case "ready":
      // The hold as a duration, the way a host would say it. Without
      // JavaScript the deadline follows as a clock time, which stays true
      // however long ago the page loaded; with it, the stylesheet hides that
      // and the page's script ticks the time left below instead. <time>
      // carries the exact deadline for both.
      return (
        <>
          <p className="ahead">
            {`${messages.holdFor(checkInWindowMs / 60_000)} `}
            <span className="deadline">
              {`${messages.checkInBy} `}
              <time dateTime={state.checkInBy.toISOString()}>
                {clockTime(state.checkInBy, timeZone)}
              </time>
              .
            </span>
          </p>
          <Countdown />
        </>
      );
    case "in-service":
      // No clock on the meal: the service is timed on the server, and the
      // card turns to "Thanks" on its own when it ends.
      return <p className="ahead">{messages.enjoyMeal}</p>;
    case "done":
    case "left":
    case "expired":
      return null;
  }
}

// Where the page's script shows the time left to check in ("0:42 left"),
// counted down to the <time> above it. Empty in the HTML, and hidden while
// empty, so without JavaScript there is no gap and nothing that never changes.
function Countdown() {
  return <p className="countdown" />;
}

// 24-hour "18:02:37" in the restaurant's time zone, whatever the server's
// is. Seconds, because the deadline falls on any second.
function clockTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(date);
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
      {/* The Copy button sits inside the field, so showing it moves
          nothing. The stylesheet shows it only when the page's script runs:
          without JavaScript it would do nothing. "custom" opts it out of
          TableKit's filled button: it's an icon. */}
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
        >
          <CopyIcon />
          <CheckIcon />
        </button>
        <span
          role="status"
          id="copy-status"
          className="visually-hidden"
          data-copied-text={messages.copiedLink}
        />
      </div>
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
