// HTTP only: every URL the app answers, at a glance, and what applies to all
// of them. What each URL does is in waitlistHandlers.ts.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import type { WaitlistService } from "../services/waitlistService.js";
import { waitlistHandlers } from "./waitlistHandlers.js";

export function waitlistRoutes(waitlist: WaitlistService): Hono {
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
  // A response that sets its own caching (the page's script) keeps it.
  routes.get("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) {
      c.header("Cache-Control", "no-store");
    }
  });

  // Every URL the app answers. waitlistHandlers.ts says how.
  const handle = waitlistHandlers(waitlist);
  // The join form; ?rejoin=<token> fills it in from a party whose visit
  // is over.
  routes.get("/", handle.showHomePage);
  routes.get("/party/:partyToken", handle.showPartyPage);
  routes.get("/party/:partyToken/card.json", handle.showPartyCardData);
  routes.get("/assets/islands.js", handle.showIslandsScript);
  routes.post("/parties", handle.joinFromForm);
  routes.post("/party/:partyToken/check-in", handle.checkInFromCard);
  routes.post("/party/:partyToken/leave", handle.leaveFromCard);
  routes.get("/health", handle.showHealth);
  routes.onError(handle.showError);

  return routes;
}
