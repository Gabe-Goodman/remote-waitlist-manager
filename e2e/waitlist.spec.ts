// Diner journeys in a phone-sized browser with JavaScript off, against the
// built app in Docker Compose (see playwright.config.ts).
import { expect, test } from "@playwright/test";

test("joins the waitlist, lands on the party's page and stays there after a reload", async ({
  page,
}) => {
  // The Compose database outlives each run, so every run needs a new email.
  const email = `ana-${Date.now()}@example.com`;

  await page.goto("/");
  // The count depends on earlier runs, so only its wording is checked.
  await expect(
    page.getByText(
      /^(No one is waiting right now|\d+ part(y is|ies are) waiting)\.$/,
    ),
  ).toBeVisible();
  await page.getByLabel("Name").fill("Ana");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Party size").selectOption("2");
  await page.getByRole("button", { name: "Join the waitlist" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "You're on the waitlist" }),
  ).toBeVisible();
  await expect(page.getByText("Ana, party of 2")).toBeVisible();
  await expect(
    page.getByText(/^(No parties|\d+ part(y|ies)) ahead of you\.$/),
  ).toBeVisible();

  await page.reload();

  // The same party came back, not just any card.
  await expect(
    page.getByRole("heading", { name: "You're on the waitlist" }),
  ).toBeVisible();
  await expect(page.getByText("Ana, party of 2")).toBeVisible();
});
