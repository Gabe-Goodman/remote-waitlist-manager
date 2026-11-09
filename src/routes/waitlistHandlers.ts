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
import { errorPage, unknownPartyPage } from "../views/errorPage.js";
import { cardFragment } from "../views/partyCard.js";
import { joinPage, partyPage } from "../views/waitlistPage.js";

// The cookie that keeps this browser's party: its value is the party's token.
const partyTokenCookie = "partyToken";

export function waitlistHandlers(waitlist: WaitlistService) {
  return {
    showHomePage,
    showPartyPage,
    showPartyCard,
    joinFromForm,
    checkInFromCard,
    leaveFromCard,
    showHealth,
    showError,
  };

  // The home page: the join form, or, for a browser that has a party, that
  // party's own page, so typing the address or opening a bookmark always
  // finds it.
  async function showHomePage(c: Context) {
    // "Join the waitlist again" (?rejoin=<token>, from the card of a party
    // whose visit is over): the same form, with that party's name and email
    // filled in, most likely the same diner. The size is asked again: the
    // group may not be the same. It only shows the form; nothing changes
    // until the diner joins, so a reload, a prefetch or a link preview is
    // harmless. A party that still holds a place has nothing to start over.
    // Filled in only for the browser that joined as the party; any other
    // browser with the link (a friend's phone, a private window) gets it
    // empty, so it never shows the party's email or joins as that diner.
    const rejoin = c.req.query("rejoin");
    const previous = rejoin ? await waitlist.find(rejoin) : undefined;
    if (previous && !holdsPlace(previous.state)) {
      const joinedAsParty =
        getCookie(c, partyTokenCookie) === previous.party.token;
      const { name, email } = joinedAsParty
        ? previous.party
        : { name: "", email: "" };
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
  // group shares one, and the address bar is the link to share. Opening it
  // only shows the party: it never becomes this browser's own (only joining
  // does that), so a friend's phone that opened the link before joining can
  // still join for its own group.
  // Typed with its path, so the party token in the URL is known to be there.
  async function showPartyPage(c: Context<BlankEnv, "/party/:partyToken">) {
    const found = await waitlist.find(c.req.param("partyToken"));
    // No such party: a visit that's over, or a link cut off or mistyped.
    // A page that says so, not a redirect to /: that would silently show
    // this browser's own party instead, or the join form to a friend whose
    // group is already in line. 200, not 404: messaging apps show a link's
    // title only for a page that loaded, so the sender sees the link is
    // broken before sending it.
    if (!found) {
      const ownPartyToken = getCookie(c, partyTokenCookie);
      const ownParty = ownPartyToken && (await waitlist.find(ownPartyToken));
      return c.html(unknownPartyPage(Boolean(ownParty)));
    }
    const { party, state } = found;
    // Whose browser this is decides the way out offered below the card:
    // the join form only where / would show it, the way back to its own
    // party where / leads there.
    const ownPartyToken = getCookie(c, partyTokenCookie);
    const ownParty = ownPartyToken && (await waitlist.find(ownPartyToken));
    const viewer = !ownParty
      ? "no-party"
      : ownParty.party.token === party.token
        ? "this-party"
        : "other-party";
    return c.html(partyPage({ party, state, origin: siteOrigin(c), viewer }));
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
    return c.html(cardFragment({ party, state, origin: siteOrigin(c) }));
  }

  async function joinFromForm(c: Context) {
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
  // still waiting, or no such party), so no separate notice is needed. 303,
  // like joining, so a reload never posts again.
  async function checkInFromCard(
    c: Context<BlankEnv, "/party/:partyToken/check-in">,
  ) {
    const partyToken = c.req.param("partyToken");
    await waitlist.checkIn(partyToken);
    return c.redirect(partyPath(partyToken), 303);
  }

  // Like check-in: whatever happened (left, or refused because it's seated,
  // already left, or the save was busy), the party's page shows its real
  // state: the left card with its "Join the waitlist again" link.
  async function leaveFromCard(
    c: Context<BlankEnv, "/party/:partyToken/leave">,
  ) {
    const partyToken = c.req.param("partyToken");
    await waitlist.leave(partyToken);
    return c.redirect(partyPath(partyToken), 303);
  }

  async function showHealth(c: Context) {
    // Loading the waitlist proves MongoDB answers and the waitlist exists.
    // The e2e tests wait for this before they start.
    await waitlist.checkHealth();
    return c.text("ok");
  }

  // Any error a route throws (a database outage, a bug) ends here: the
  // details go to the server log, the diner gets a plain page with a Try
  // again link back to where they were.
  function showError(error: Error, c: Context) {
    // An HTTPException already carries the right answer (the body limit's
    // 413); only unexpected errors become the 500 page.
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.html(errorPage(retryPath(c)), 500);
  }
}

// Waiting, ready or seated: the party still has a place this browser
// mustn't lose. A party that finished or left has none.
function holdsPlace(state: PartyState): boolean {
  return state.kind !== "done" && state.kind !== "left";
}

// Where the error page's Try again goes. A page (GET) loads again: it
// changes nothing, and a friend who opened a party's link gets the party
// back rather than the join form. An action on a party (check in, leave)
// goes to that party's page, which shows what really happened, instead of
// acting again. Anything else, such as a join, goes to /. One leading
// slash, so the link can never point to another site.
function retryPath(c: Context): string {
  const url = new URL(c.req.url);
  const path = `/${url.pathname.replace(/^\/+/, "")}`;
  if (c.req.method !== "POST") return path + url.search;
  return /^(\/party\/[^/]+)\/[^/]+$/.exec(path)?.[1] ?? "/";
}

// A party's own page.
function partyPath(partyToken: string): string {
  return `/party/${partyToken}`;
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
