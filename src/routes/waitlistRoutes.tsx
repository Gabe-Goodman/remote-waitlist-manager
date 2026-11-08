// HTTP only: every URL the app answers. The rules live in domain/, the use
// cases in services/; this file reads requests and picks the response.
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { JoinForm } from "../domain/waitlist.js";
import {
  checkInParty,
  findParty,
  joinWaitlist,
  waitingCount,
  type Environment,
} from "../services/waitlistService.js";
import type { WaitlistStore } from "../storage/waitlistStore.js";
import { ErrorPage } from "../views/errorPage.js";
import { toHtml } from "../views/html.js";
import { WaitlistPage } from "../views/waitlistPage.js";

export function waitlistRoutes(store: WaitlistStore, env: Environment): Hono {
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

  routes.get("/", async (c) => {
    const token = getCookie(c, "party");
    const found = token ? await findParty(store, env, token) : undefined;
    if (found) {
      const { party, state } = found;
      return c.html(
        toHtml(
          <WaitlistPage party={party} state={state} origin={siteOrigin(c)} />,
        ),
      );
    }
    // A cookie for a party that isn't on the waitlist is dead: clear it, so
    // the browser stops sending it, and show the join form.
    if (token) deleteCookie(c, "party", { path: "/" });
    const waiting = await waitingCount(store);
    // A new key for every rendering: each fresh form is a new attempt. A
    // refused join's form keeps the key it was sent with instead.
    const values = { name: "", email: "", size: "", joinKey: env.newToken() };
    return c.html(toHtml(<WaitlistPage waiting={waiting} values={values} />));
  });

  // The done card's "Join the waitlist again" link. It only shows the form:
  // nothing changes until the diner joins, when POST /parties replaces the
  // finished party in this browser. So a reload, a prefetch or a link
  // preview is harmless, and a party that doesn't join still sees its
  // thank-you card at /.
  routes.get("/join-again", async (c) => {
    const token = getCookie(c, "party");
    const found = token ? await findParty(store, env, token) : undefined;
    // Only a finished party can join again; anyone else has nothing to
    // start over, so they go back to /.
    if (found?.state.kind !== "done") return c.redirect("/", 303);
    // Most likely the same diner, so their name and email are filled in.
    // The size is asked again: the group may not be the same this time.
    const { name, email } = found.party;
    const waiting = await waitingCount(store);
    return c.html(
      toHtml(
        <WaitlistPage
          waiting={waiting}
          values={{ name, email, size: "", joinKey: env.newToken() }}
        />,
      ),
    );
  });

  routes.post("/parties", async (c) => {
    // One active party per browser. A stale form (back button, old tab) must
    // neither change the party's details nor add a second place in the
    // queue; someone joining for another group uses another phone. The
    // diner goes back to their card, which shows the party they hold. A
    // party whose meal is over holds nothing, so its browser may join again.
    const own = getCookie(c, "party");
    const ownParty = own ? await findParty(store, env, own) : undefined;
    if (ownParty && ownParty.state.kind !== "done") {
      return c.redirect("/", 303);
    }
    const form = await readJoinForm(c.req.parseBody());
    const outcome = await joinWaitlist(store, env, form);
    if (outcome.ok) {
      rememberParty(c, outcome.party.token);
      // Post/Redirect/Get: 303 sends the browser to / with a GET, so a reload
      // or the back button never submits the form a second time.
      return c.redirect("/", 303);
    }
    // A refused join shows the form again with what the diner typed.
    const waiting = await waitingCount(store);
    if (outcome.reason === "invalid") {
      const refused = {
        values: form,
        errors: outcome.errors,
        notice: "fix-fields" as const,
      };
      return c.html(
        toHtml(<WaitlistPage waiting={waiting} refused={refused} />),
        422,
      );
    }
    // Duplicate and busy keep what was typed too; only the notice differs.
    // Busy is 409, not 503: the save conflicted with others; the server
    // itself is fine, and tapping Join again will most likely work.
    const refused = { values: form, notice: outcome.reason };
    return c.html(
      toHtml(<WaitlistPage waiting={waiting} refused={refused} />),
      409,
    );
  });

  // Success or refusal, the answer is the same: the card at / shows the
  // party's real state (checked in, still waiting, or the join form for an
  // unknown party), so no separate notice is needed. 303, like joining, so a
  // reload never posts the check-in again.
  routes.post("/check-in", async (c) => {
    const token = getCookie(c, "party");
    if (token) await checkInParty(store, env, token);
    return c.redirect("/", 303);
  });

  // The token is 128 random bits, so the link is the key to the party:
  // whoever has it can act for the party, which is how a group shares one.
  // It never replaces this browser's own party: opening a friend's link
  // mustn't lose your own place. A party whose meal is over has no place to
  // lose, so a link may replace it. Instead of quietly redirecting, the diner
  // who tapped the link is told why they see their own party, not the one
  // they opened. The page is answered at the link's URL, so no flag or
  // extra cookie carries the notice, and a reload repeats a harmless GET.
  routes.get("/party/:token", async (c) => {
    const own = getCookie(c, "party");
    const token = c.req.param("token");
    const ownParty =
      own !== undefined && own !== token
        ? await findParty(store, env, own)
        : undefined;
    if (ownParty && ownParty.state.kind !== "done") {
      return c.html(
        toHtml(
          <WaitlistPage
            party={ownParty.party}
            state={ownParty.state}
            origin={siteOrigin(c)}
            notice="other-party"
          />,
        ),
      );
    }
    if (await findParty(store, env, token)) rememberParty(c, token);
    return c.redirect("/", 303);
  });

  // Any error a route throws (a database outage, a bug) ends here: the
  // details go to the server log, the diner gets a plain page with a Try
  // again link.
  routes.onError((error, c) => {
    // An HTTPException already carries the right answer (the body limit's
    // 413); only unexpected errors become the 500 page.
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.html(toHtml(<ErrorPage />), 500);
  });

  routes.get("/health", async (c) => {
    // Loading the waitlist proves MongoDB answers and the waitlist exists.
    // The e2e tests wait for this before they start.
    await store.load();
    return c.text("ok");
  });

  return routes;
}

// The site's address as this request reached it, so a shared link points
// wherever the diner found the app.
function siteOrigin(c: Context): string {
  return new URL(c.req.url).origin;
}

// HttpOnly: page scripts can't read the token. SameSite=Lax: other sites
// can't post with it. Secure over HTTPS. Six hours outlasts any wait for a
// table.
function rememberParty(c: Context, token: string): void {
  setCookie(c, "party", token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: 6 * 60 * 60,
    path: "/",
  });
}

/**
 * The form's fields as text. A missing field reads as "": a skipped party
 * size (its disabled "Choose…" option isn't submitted) then fails
 * validation instead of crashing here.
 */
async function readJoinForm(
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
