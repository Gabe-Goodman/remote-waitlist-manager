// The live card with JavaScript on: a waiting diner's card changes on its
// own, with no reload. Against the built app in Docker Compose. It needs an
// empty restaurant, so playwright.config.ts runs it first, on its own.
import {
  expect,
  test,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

test.use({ javaScriptEnabled: true });

async function joinAsDiner(
  page: Page,
  { name, size }: { name: string; size: string },
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(`${name.toLowerCase()}@example.com`);
  await page.getByLabel("Party size").selectOption(size);
  await page.getByRole("button", { name: "Join the waitlist" }).click();
}

test("doesn't swap the card when only the page changed, so the bell rings once", async ({
  page,
}) => {
  // A party of 1 in the empty restaurant is ready at once, and stays ready.
  await joinAsDiner(page, { name: "Lee", size: "1" });
  const card = page.locator("live-card > section.card");
  await expect(card).toHaveAttribute("data-state", "ready");
  // A property, not an attribute, so it changes nothing in the card's HTML:
  // a swapped-in card won't have it.
  await card.evaluate((el) => Object.assign(el, { original: true }));

  // Opening Leave changes the card in the page (its <details> is open), not
  // the party. Each swap would ring the bell again.
  await page.getByText("Leave the waitlist").click();
  // The third request starts only once the second answer has been handled.
  for (let poll = 0; poll < 3; poll++) {
    await page.waitForResponse((response) => response.url().endsWith("/card"));
  }

  expect(await card.evaluate((el) => "original" in el)).toBe(true);

  // Leave, so the next journey has the empty restaurant it needs.
  await page.getByRole("button", { name: "Yes, leave" }).click();
  await expect(
    page.getByRole("heading", { name: "You've left the waitlist" }),
  ).toBeVisible();
});

test("shows the Check-in button the moment the table is ready, without a reload", async ({
  browser,
  page,
}) => {
  const heading = (p: Page, name: string) =>
    p.getByRole("heading", { name, exact: true });
  const checkInButton = (p: Page) =>
    p.getByRole("button", { name: "Check in", exact: true });

  await joinAsDiner(page, { name: "Lia", size: "1" });
  await expect(checkInButton(page)).toBeVisible();

  // Another phone: a party of 10 waits behind the seat Lia holds.
  // The project's settings turn JavaScript off; this phone needs it on.
  const other = await browser.newContext({
    ...(test.info().project.use as BrowserContextOptions),
    javaScriptEnabled: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const otherPage = await other.newPage();
  await joinAsDiner(otherPage, { name: "Max", size: "10" });
  await expect(otherPage.getByText("1 party ahead of you.")).toBeVisible();

  // From here on Max's page is never reloaded: every change comes from the
  // card updating itself. Lia's service lasts 3 seconds.
  await checkInButton(page).click();
  await expect(otherPage.getByText("You're next. Stay close.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(heading(otherPage, "Your table is ready!")).toBeVisible({
    timeout: 10_000,
  });
  await expect(checkInButton(otherPage)).toBeVisible();
  await expect(otherPage).toHaveTitle("Your table is ready!");

  // The card swapped in brought its own Copy button, and it works: the
  // <copy-link> island sets itself up when it's added to the page.
  await otherPage.getByRole("button", { name: "Copy link" }).click();
  await expect(otherPage.getByRole("status")).toHaveText("Link copied");
  const link = await otherPage.getByLabel("This party's link").inputValue();
  expect(await otherPage.evaluate(() => navigator.clipboard.readText())).toBe(
    link,
  );

  // Max leaves, so the next journeys start with every seat free once Lia's
  // short service ends.
  await otherPage.getByText("Leave the waitlist").click();
  await otherPage.getByRole("button", { name: "Yes, leave" }).click();
  await expect(heading(otherPage, "You've left the waitlist")).toBeVisible();

  await other.close();
});
