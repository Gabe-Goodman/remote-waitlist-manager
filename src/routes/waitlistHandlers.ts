// What each URL does: reads the request (cookie, form, URL), asks the
// waitlist service, and picks the page or redirect. The URL table itself is
// in waitlistRoutes.ts; the rules live in domain/, the use cases in
// services/, the HTML in views/.
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { BlankEnv } from "hono/types";
import type { JoinForm, PartyState } from "../domain/waitlist.js";
import type { WaitlistService } from "../services/waitlistService.js";
import { errorPage } from "../views/errorPage.js";
import { cardFragment } from "../views/partyCard.js";
import { joinPage, partyPage } from "../views/waitlistPage.js";

// The cookie that keeps this browser's party: its value is the party's token.
const partyTokenCookie = "partyToken";

// timeZone: the restaurant's, for the check-in deadline on the card.
export function waitlistHandlers(waitlist: WaitlistService, timeZone: string) {
  return {
    showPage,
    showPartyPage,
    showPartyCard,
    join,
    checkIn,
    leave,
    showHealth,
    showError,
  };

  // The home page: the join form, or, for a browser that has a party, that
  // party's own page, so typing the address or opening a bookmark always
  // finds it.
  async function showPage(c: Context) {
    // "Join the waitlist again" (?rejoin=<token>, from the card of a party
    // whose visit is over): the same form, with that party's name and email
    // filled in, most likely the same diner. The size is asked again: the
    // group may not be the same. It only shows the form; nothing changes
    // until the diner joins, so a reload, a prefetch or a link preview is
    // harmless. A party that still holds a place has nothing to start over.
    const rejoin = c.req.query("rejoin");
    const previous = rejoin ? await waitlist.find(rejoin) : undefined;
    if (previous && !holdsPlace(previous.state)) {
      const { name, email } = previous.party;
      const waiting = await waitlist.waitingCount();
      return c.html(
        joinPage({
          waiting,
          values: { name, email, size: "", joinKey: waitlist.newJoinKey() },
        }),
      );
    }
    const partyToken = getCookie(c, partyTokenCookie);
    const found = partyToken ? await waitlist.find(partyToken) : undefined;
    if (found) return c.redirect(partyPath(found.party.token), 303);
    // A cookie for a party that isn't on the waitlist is dead: clear it, so
    // the browser stops sending it, and show the join form.
    if (partyToken) deleteCookie(c, partyTokenCookie, { path: "/" });
    const waiting = await waitlist.waitingCount();
    // A new key for every rendering: each fresh form is a new attempt. A
    // refused join's form keeps the key it was sent with instead.
    const values = {
      name: "",
      email: "",
      size: "",
      joinKey: waitlist.newJoinKey(),
    };
    return c.html(joinPage({ waiting, values }));
  }

  // A party's own page. The token is 128 random bits, so the link is the key
  // to the party: whoever has it can see it and act for it, which is how a
  // group shares one, and the address bar is the link to share. Opening a
  // friend's link shows the friend's party; this browser keeps following its
  // own, so it only remembers the link's party when it has no active party
  // of its own.
  // Typed with its path, so the party token in the URL is known to be there.
  async function showPartyPage(c: Context<BlankEnv, "/party/:partyToken">) {
    const found = await waitlist.find(c.req.param("partyToken"));
    // No such party: a mistyped or very old link.
    if (!found) return c.redirect("/", 303);
    const { party, state } = found;
    if (!(await holdsActiveParty(c, party.token))) {
      setPartyCookie(c, party.token);
    }
    return c.html(partyPage({ party, state, origin: siteOrigin(c), timeZone }));
  }

  // The party's card on its own, which the card's live updates fetch. The
  // page and this route render the same component, so an update can't show
  // a card the page wouldn't.
  async function showPartyCard(
    c: Context<BlankEnv, "/party/:partyToken/card">,
  ) {
    const found = await waitlist.find(c.req.param("partyToken"));
    // No party any more: nothing to keep up to date.
    if (!found) return c.body(null, 204);
    const { party, state } = found;
    return c.html(
      cardFragment({ party, state, origin: siteOrigin(c), timeZone }),
    );
  }

  // Whether this browser follows a party, other than `except`, that still
  // holds a place: one it mustn't lose by following another.
  async function holdsActiveParty(c: Context, except: string) {
    const ownPartyToken = getCookie(c, partyTokenCookie);
    if (!ownPartyToken || ownPartyToken === except) return false;
    const own = await waitlist.find(ownPartyToken);
    return own !== undefined && holdsPlace(own.state);
  }

  async function join(c: Context) {
    // One active party per browser. A stale form (back button, old tab) must
    // neither change the party's details nor add a second place in the
    // queue; someone joining for another group uses another phone. The
    // diner goes back to their card, which shows the party they hold. A
    // party whose meal is over, or that left, holds nothing, so its browser
    // may join again.
    const ownPartyToken = getCookie(c, partyTokenCookie);
    const ownParty = ownPartyToken
      ? await waitlist.find(ownPartyToken)
      : undefined;
    if (ownParty && holdsPlace(ownParty.state)) {
      return c.redirect(partyPath(ownParty.party.token), 303);
    }
    const form = await joinFormFrom(c.req.parseBody());
    const outcome = await waitlist.join(form);
    if (outcome.ok) {
      setPartyCookie(c, outcome.party.token);
      // Post/Redirect/Get: 303 sends the browser to the party's page with a
      // GET, so a reload or the back button never submits the form again.
      return c.redirect(partyPath(outcome.party.token), 303);
    }
    // A refused join shows the form again with what the diner typed.
    const waiting = await waitlist.waitingCount();
    if (outcome.reason === "invalid") {
      return c.html(
        joinPage({
          waiting,
          values: form,
          errors: outcome.errors,
          notice: "fix-fields",
        }),
        422,
      );
    }
    // Duplicate and busy keep what was typed too; only the notice differs.
    // Busy is 409, not 503: the save conflicted with others; the server
    // itself is fine, and tapping Join again will most likely work.
    return c.html(
      joinPage({ waiting, values: form, notice: outcome.reason }),
      409,
    );
  }

  // Acts on the party in the URL, not the cookie's: a friend's phone on the
  // friend's page checks in the friend's party. Success or refusal, the
  // answer is the same: the party's page shows its real state (checked in,
  // still waiting), so no separate notice is needed; an unknown party goes
  // to the join form. 303, like joining, so a reload never posts again.
  async function checkIn(c: Context<BlankEnv, "/party/:partyToken/check-in">) {
    const partyToken = c.req.param("partyToken");
    const outcome = await waitlist.checkIn(partyToken);
    return c.redirect(afterAction(outcome, partyToken), 303);
  }

  // Like check-in: whatever happened (left, or refused because it's seated,
  // already left, or the save was busy), the party's page shows its real
  // state: the left card with its "Join the waitlist again" link.
  async function leave(c: Context<BlankEnv, "/party/:partyToken/leave">) {
    const partyToken = c.req.param("partyToken");
    const outcome = await waitlist.leave(partyToken);
    return c.redirect(afterAction(outcome, partyToken), 303);
  }

  async function showHealth(c: Context) {
    // Loading the waitlist proves MongoDB answers and the waitlist exists.
    // The e2e tests wait for this before they start.
    await waitlist.checkHealth();
    return c.text("ok");
  }

  // Any error a route throws (a database outage, a bug) ends here: the
  // details go to the server log, the diner gets a plain page with a Try
  // again link.
  function showError(error: Error, c: Context) {
    // An HTTPException already carries the right answer (the body limit's
    // 413); only unexpected errors become the 500 page.
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.html(errorPage(), 500);
  }
}

// Waiting, ready or seated: the party still has a place this browser
// mustn't lose. A party that finished, left or ran out of time has none.
function holdsPlace(state: PartyState): boolean {
  return (
    state.kind !== "done" && state.kind !== "left" && state.kind !== "expired"
  );
}

// A party's own page.
function partyPath(partyToken: string): string {
  return `/party/${partyToken}`;
}

// Back to the party's page after an action, or to the join form if there's
// no such party.
function afterAction(
  outcome: { ok: true } | { ok: false; reason: string },
  partyToken: string,
): string {
  return !outcome.ok && outcome.reason === "not-found"
    ? "/"
    : partyPath(partyToken);
}

// The site's address as this request reached it, so a shared link points
// wherever the diner found the app.
function siteOrigin(c: Context): string {
  return new URL(c.req.url).origin;
}

// HttpOnly: page scripts can't read the token. SameSite=Lax: other sites
// can't post with it. Secure over HTTPS. Six hours outlasts any wait for a
// table.
function setPartyCookie(c: Context, partyToken: string): void {
  setCookie(c, partyTokenCookie, partyToken, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: 6 * 60 * 60,
    path: "/",
  });
}

/**
 * The join form as plain text. A parsed body gives each field as a string,
 * a File or nothing; the rules expect four strings, so anything else reads
 * as "": a skipped party size (its disabled "Choose…" option isn't
 * submitted) then fails validation instead of crashing here.
 */
async function joinFormFrom(
  body: Promise<Record<string, string | File>>,
): Promise<JoinForm> {
  const fields = await body;
  const text = (name: string) => {
    const value = fields[name];
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    email: text("email"),
    size: text("size"),
    joinKey: text("joinKey"),
  };
}
