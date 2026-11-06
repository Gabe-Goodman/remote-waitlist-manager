// Smoke test, not a diner journey: it only proves the built image starts,
// connects to MongoDB and serves requests. No route test can see that.
// Runs against the app in Docker Compose (see playwright.config.ts).
import { expect, test } from "@playwright/test";

test("the built app starts and answers its health check", async ({
  request,
}) => {
  const response = await request.get("/health");

  expect(response.status()).toBe(200);
});
