// HTTP only: every URL the app answers. The rules live in domain/, the use
// cases in services/; this file reads requests and picks the response.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { BlankEnv } from "hono/types";
import type { JoinForm, PartyState } from "../domain/waitlist.js";
import type { WaitlistService } from "../services/waitlistService.js";
import { ErrorPage } from "../views/errorPage.js";
import { toFragment, toHtml } from "../views/html.js";
import { PartyCard } from "../views/partyCard.js";
import { WaitlistPage } from "../views/waitlistPage.js";

// The cookie that keeps this browser's party: its value is the party's token.
const partyTokenCookie = "partyToken";

// timeZone: the restaurant's, for the check-in deadline on the card. Passed
// in rather than read here, so tests can fix it.
export function waitlistRoutes(
  waitlist: WaitlistService,
  timeZone: string,
): Hono {
  const routes = new Hono();

  // Every page carries TableKit's 115 KB stylesheet; gzipped it's about
  // 15 KB, which matters on a slow phone connection.
  routes.use("*", compress());

  // Registered before the routes, so every POST route below it, now and
  // later, refuses bodies over 10 KB, so no route reads more than that. The
  // largest valid join form is 726 bytes, so anything bigger didn't come
  // from the form.
  routes.post("*", bodyLimit({ maxSize: 10 * 1024 }));

  // A page shows the party's state when it was rendered, so a kept copy
  // (back button, restored tab) can show a state that's no longer true, such
  // as the join form after joining. no-store makes the browser ask again.
  // GETs only: on a refused join's page, Chrome's back button would ask to
  // resubmit the form.
  routes.get("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  // Every URL the app answers. The handlers below say how.
  routes.get("/", showPage);
  routes.get("/card", showCard);
  routes.get("/party/:partyToken", openPartyLink);
  routes.get("/join-again", showJoinAgainForm);
  routes.post("/parties", join);
  routes.post("/check-in", checkIn);
  routes.post("/leave", leave);
  routes.get("/health", showHealth);
  routes.onError(showError);

  return routes;

  async function showPage(c: Context) {
    const partyToken = getCookie(c, partyTokenCookie);
    const found = partyToken ? await waitlist.find(partyToken) : undefined;
    if (found) {
      const { party, state } = found;
      return c.html(
        toHtml(
          <WaitlistPage
            party={party}
            state={state}
            origin={siteOrigin(c)}
            timeZone={timeZone}
          />,
        ),
      );
    }
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
    return c.html(toHtml(<WaitlistPage waiting={waiting} values={values} />));
  }

  // The card on its own, which the card's live updates fetch. The page and
  // this route render the same component, so an update can't show a card
  // the page wouldn't.
  async function showCard(c: Context) {
    const partyToken = getCookie(c, partyTokenCookie);
    const found = partyToken ? await waitlist.find(partyToken) : undefined;
    // No card to send: a page without a party is the join form, which has
    // no card to update. A dead cookie is left for / to clear.
    if (!found) return c.body(null, 204);
    const { party, state } = found;
    return c.html(
      toFragment(
        <PartyCard
          party={party}
          state={state}
          origin={siteOrigin(c)}
          timeZone={timeZone}
        />,
      ),
    );
  }

  // The token is 128 random bits, so the link is the key to the party:
  // whoever has it can act for the party, which is how a group shares one.
  // It never replaces this browser's own party: opening a friend's link
  // mustn't lose your own place. A party whose meal is over, or that left,
  // has no place to lose, so a link may replace it. Instead of quietly
  // redirecting, the diner who tapped the link is told why they see their
  // own party, not the one they opened. The page is answered at the link's
  // URL, so no flag or extra cookie carries the notice, and a reload repeats
  // a harmless GET.
  // Typed with its path, so the party token in the URL is known to be there.
  async function openPartyLink(c: Context<BlankEnv, "/party/:partyToken">) {
    const ownPartyToken = getCookie(c, partyTokenCookie);
    const linkPartyToken = c.req.param("partyToken");
    const ownParty =
      ownPartyToken !== undefined && ownPartyToken !== linkPartyToken
        ? await waitlist.find(ownPartyToken)
        : undefined;
    if (ownParty && holdsPlace(ownParty.state)) {
      return c.html(
        toHtml(
          <WaitlistPage
            party={ownParty.party}
            state={ownParty.state}
            origin={siteOrigin(c)}
            timeZone={timeZone}
            notice="other-party"
          />,
        ),
      );
    }
    if (await waitlist.find(linkPartyToken)) setPartyCookie(c, linkPartyToken);
    return c.redirect("/", 303);
  }

  // The "Join the waitlist again" link on the done and left cards. It only
  // shows the form: nothing changes until the diner joins, when POST
  // /parties replaces the old party in this browser. So a reload, a prefetch
  // or a link preview is harmless, and a party that doesn't join still sees
  // its card at /.
  async function showJoinAgainForm(c: Context) {
    const partyToken = getCookie(c, partyTokenCookie);
    const found = partyToken ? await waitlist.find(partyToken) : undefined;
    // Only a party that finished or left can join again; anyone else has
    // nothing to start over, so they go back to /.
    if (!found || holdsPlace(found.state)) return c.redirect("/", 303);
    // Most likely the same diner, so their name and email are filled in.
    // The size is asked again: the group may not be the same this time.
    const { name, email } = found.party;
    const waiting = await waitlist.waitingCount();
    return c.html(
      toHtml(
        <WaitlistPage
          waiting={waiting}
          values={{ name, email, size: "", joinKey: waitlist.newJoinKey() }}
        />,
      ),
    );
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
      return c.redirect("/", 303);
    }
    const form = await joinFormFrom(c.req.parseBody());
    const outcome = await waitlist.join(form);
    if (outcome.ok) {
      setPartyCookie(c, outcome.party.token);
      // Post/Redirect/Get: 303 sends the browser to / with a GET, so a reload
      // or the back button never submits the form a second time.
      return c.redirect("/", 303);
    }
    // A refused join shows the form again with what the diner typed.
    const waiting = await waitlist.waitingCount();
    if (outcome.reason === "invalid") {
      return c.html(
        toHtml(
          <WaitlistPage
            waiting={waiting}
            values={form}
            errors={outcome.errors}
            notice="fix-fields"
          />,
        ),
        422,
      );
    }
    // Duplicate and busy keep what was typed too; only the notice differs.
    // Busy is 409, not 503: the save conflicted with others; the server
    // itself is fine, and tapping Join again will most likely work.
    return c.html(
      toHtml(
        <WaitlistPage
          waiting={waiting}
          values={form}
          notice={outcome.reason}
        />,
      ),
      409,
    );
  }

  // Success or refusal, the answer is the same: the card at / shows the
  // party's real state (checked in, still waiting, or the join form for an
  // unknown party), so no separate notice is needed. 303, like joining, so a
  // reload never posts the check-in again.
  async function checkIn(c: Context) {
    const partyToken = getCookie(c, partyTokenCookie);
    if (partyToken) await waitlist.checkIn(partyToken);
    return c.redirect("/", 303);
  }

  // Like check-in: whatever happened (left, or refused because there's no
  // party, it's seated, it already left, or the save was busy), the card at /
  // shows the party's real state. The cookie stays, so / shows the left card
  // with its "Join the waitlist again" link, as it does for a finished party.
  async function leave(c: Context) {
    const partyToken = getCookie(c, partyTokenCookie);
    if (partyToken) await waitlist.leave(partyToken);
    return c.redirect("/", 303);
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
    return c.html(toHtml(<ErrorPage />), 500);
  }
}

// Waiting, ready or seated: the party still has a place this browser
// mustn't lose. A party that finished, left or ran out of time has none.
function holdsPlace(state: PartyState): boolean {
  return (
    state.kind !== "done" && state.kind !== "left" && state.kind !== "expired"
  );
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
