// The party's current state: waiting (with its place in the queue), ready
// (with the Check-in button), checked in, or done or left (with a link to
// join again); its name and size; while it still has a place, its
// link, ready to copy; and, while it's still in the queue, a way to leave.
// Renders only: the route passes in the state and the site's origin.
import type { Party, PartyState } from "../domain/waitlist.js";
import { toFragment } from "./html.js";
import { Icon, type IconName } from "./icons.js";
import { cardTitles, messages } from "./messages.js";

type PartyCardProps = {
  party: Party;
  state: PartyState;
  origin: string;
};

// The card on its own, as HTML, for the live update: the same component the
// page shows, so an update can't show a card the page wouldn't.
export function cardFragment(props: PartyCardProps): string {
  return toFragment(<PartyCard {...props} />);
}

// origin: the site's address as the diner reached it, so the link works
// when opened on another phone.
export function PartyCard({ party, state, origin }: PartyCardProps) {
  const placeGone = state.kind === "done" || state.kind === "left";
  const inQueue = state.kind === "waiting" || state.kind === "ready";
  const stateIcon = stateIcons[state.kind];
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
          for every time they glance at their phone. The state's icon sits
          at the panel's right edge, beside the words it repeats. */}
      <div className="place">
        <div>
          <StateLine state={state} />
          <p>{messages.partyLine(party.name, party.size)}</p>
        </div>
        {stateIcon && (
          <Icon name={stateIcon} size={40} className="state-icon" />
        )}
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

// An icon only while something is happening: these are the states a diner
// glances at again and again, and the icon says where they stand before they
// read. Once the visit is over the heading is read once, and any symbol for
// leaving (an arrow, a cross) looks like something to tap.
const stateIcons: Partial<Record<PartyState["kind"], IconName>> = {
  waiting: "hourglass",
  ready: "bell",
  "in-service": "restaurant",
};

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
          <Icon name="copy" size={18} className="icon-copy" />
          <Icon name="checkmark" size={18} className="icon-check" />
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
