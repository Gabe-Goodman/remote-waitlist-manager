// HTTP only: every URL the app answers. No rules and no database access;
// what a route needs from outside (for now, a database ping) is passed in.
import { Hono } from "hono";

export function waitlistRoutes(ping: () => Promise<void>): Hono {
  // The health check: is the app up, and can it reach its database?
  // The e2e tests wait for it before they start.
  return new Hono().get("/health", async (c) => {
    await ping();
    return c.text("ok");
  });
}
