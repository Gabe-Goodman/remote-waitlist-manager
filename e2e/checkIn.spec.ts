// The check-in journey in a phone-sized browser with JavaScript off, against
// the built app in Docker Compose. It needs an empty restaurant, so
// playwright.config.ts runs it before the other journeys.
import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";

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

// The card shows the state as of each page load, so a change that comes
// with time (a service ending) only appears after a reload.
async function reloadUntilVisible(page: Page, target: Locator): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(target).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test("lets the next party check in once a service ends, and the first join again", async ({
  browser,
  page,
}) => {
  const heading = (p: Page, name: string) =>
    p.getByRole("heading", { name, exact: true });
  const checkInButton = (p: Page) =>
    p.getByRole("button", { name: "Check in", exact: true });

  // A party of 1 is served for 3 seconds, so the test waits only briefly.
  await joinAsDiner(page, { name: "Ana", size: "1" });
  await expect(heading(page, "Your table is ready!")).toBeVisible();
  await expect(checkInButton(page)).toBeVisible();

  // A second browser shares no cookies with the first, like another phone.
  // A party of 10 can't fit beside the seat Ana holds, so it waits until
  // her service ends.
  const other = await browser.newContext(
    test.info().project.use as BrowserContextOptions,
  );
  const otherPage = await other.newPage();
  await joinAsDiner(otherPage, { name: "Ben", size: "10" });
  await expect(heading(otherPage, "You're on the waitlist")).toBeVisible();
  // Ana is ready but hasn't checked in, so she's still ahead in the queue.
  await expect(otherPage.getByText("1 party ahead of you.")).toBeVisible();
  await expect(checkInButton(otherPage)).toBeHidden();

  await checkInButton(page).click();
  await expect(heading(page, "You're checked in")).toBeVisible();
  await expect(page.getByText("Enjoy your meal.")).toBeVisible();

  // Seated, Ana has left the queue: Ben is next, but her seat is still taken.
  await otherPage.reload();
  await expect(
    otherPage.getByText("You're next. Stay close and keep this page open."),
  ).toBeVisible();
  await expect(checkInButton(otherPage)).toBeHidden();

  await reloadUntilVisible(
    otherPage,
    heading(otherPage, "Your table is ready!"),
  );
  await checkInButton(otherPage).click();
  await expect(heading(otherPage, "You're checked in")).toBeVisible();

  await reloadUntilVisible(page, heading(page, "Thanks for dining"));

  // Ana comes back: her name and email are filled in, the size is asked
  // again, and her finished party no longer holds her email.
  await page.getByRole("link", { name: "Join the waitlist again" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Ana");
  await expect(page.getByLabel("Email")).toHaveValue("ana@example.com");
  await page.getByLabel("Party size").selectOption("1");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  // Ben's 10 seats are in service, so Ana waits at the front this time.
  await expect(heading(page, "You're on the waitlist")).toBeVisible();
  await expect(page.getByText("Ana, party of 1")).toBeVisible();

  await other.close();
});
