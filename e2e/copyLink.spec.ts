// The one journey with JavaScript on: the Copy button exists only for
// browsers that run the card's script. Against the built app in Docker
// Compose (see playwright.config.ts).
import { expect, test } from "@playwright/test";

test.use({
  javaScriptEnabled: true,
  permissions: ["clipboard-read", "clipboard-write"],
});

test("copies the party's link with one tap", async ({ page }) => {
  // The Compose database outlives each run, so every run needs a new email.
  const email = `cleo-${Date.now()}@example.com`;

  await page.goto("/");
  await page.getByLabel("Name").fill("Cleo");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Party size").selectOption("2");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await page.getByRole("button", { name: "Copy link" }).click();

  await expect(page.getByRole("status")).toHaveText("Link copied");
  const link = await page.getByLabel("Your party's link").inputValue();
  expect(link).toMatch(/\/party\/[\w-]+$/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
});
