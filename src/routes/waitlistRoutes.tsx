// HTTP only: every URL the app answers. The rules live in domain/, the use
// cases in services/; this file reads requests and picks the response.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { JoinForm } from "../domain/waitlist.js";
import {
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

  // Registered first, so every POST route below it, now and later, refuses
  // bodies over 10 KB, so no route reads more than that. The largest valid
  // join form is 726 bytes, so anything bigger didn't come from the form.
  routes.post("*", bodyLimit({ maxSize: 10 * 1024 }));

  routes.get("/", async (c) => {
    const token = getCookie(c, "party");
    const place = token ? await findParty(store, token) : undefined;
    if (place) return c.html(toHtml(<WaitlistPage place={place} />));
    // A cookie for a party that isn't on the waitlist is dead: clear it, so
    // the browser stops sending it, and show the join form.
    if (token) deleteCookie(c, "party", { path: "/" });
    const waiting = await waitingCount(store);
    return c.html(toHtml(<WaitlistPage waiting={waiting} />));
  });

  routes.post("/parties", async (c) => {
    const form = await readJoinForm(c.req.parseBody());
    const outcome = await joinWaitlist(store, env, form);
    if (outcome.ok) {
      // HttpOnly: page scripts can't read the token. SameSite=Lax: other
      // sites can't post with it. Secure over HTTPS. Six hours outlasts any
      // wait for a table.
      setCookie(c, "party", outcome.party.token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(c.req.url).protocol === "https:",
        maxAge: 6 * 60 * 60,
        path: "/",
      });
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
  return { name: text("name"), email: text("email"), size: text("size") };
}
