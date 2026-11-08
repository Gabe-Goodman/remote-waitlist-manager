// Diner journeys in a phone-sized browser with JavaScript off, against the
// built app in Docker Compose (see playwright.config.ts).
import {
  expect,
  test,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

// The journeys share one restaurant, so every party needs its own email.
function uniqueEmail(name: string): string {
  return `${name}-${Date.now()}@example.com`;
}

// A party joining an empty restaurant is ready at once; behind others, it
// waits. The journeys share one restaurant, so either can happen.
const cardHeading = /^(You're on the waitlist|Your table is ready!)$/;

async function fillJoinForm(
  page: Page,
  { name, email, size }: { name: string; email: string; size?: string },
): Promise<void> {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  if (size) await page.getByLabel("Party size").selectOption(size);
  await page.getByRole("button", { name: "Join the waitlist" }).click();
}

test("joins the waitlist, lands on the party's page and stays there after a reload", async ({
  page,
}) => {
  await page.goto("/");
  // The count depends on earlier runs, so only its wording is checked.
  await expect(
    page.getByText(
      /^(No one is waiting right now|\d+ part(y is|ies are) waiting)\.$/,
    ),
  ).toBeVisible();
  await fillJoinForm(page, {
    name: "Ana",
    email: uniqueEmail("ana"),
    size: "2",
  });

  // The party's own page: the address bar is the link to share.
  await expect(page).toHaveURL(/\/party\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: cardHeading })).toBeVisible();
  await expect(page.getByText("Ana, party of 2")).toBeVisible();
  await expect(
    page.getByText(
      /^(You're next\. Stay close and keep this page open\.|\d+ part(y|ies) ahead of you\.|Check in now\.)$/,
    ),
  ).toBeVisible();
  // Without JavaScript the Copy button would do nothing, so it stays hidden.
  await expect(page.locator("#copy-link")).toBeHidden();

  await page.reload();

  // The same party came back, not just any card.
  await expect(page.getByRole("heading", { name: cardHeading })).toBeVisible();
  await expect(page.getByText("Ana, party of 2")).toBeVisible();
});

test("views the party from another browser session", async ({
  browser,
  page,
}) => {
  await page.goto("/");
  await fillJoinForm(page, {
    name: "Bea",
    email: uniqueEmail("bea"),
    size: "3",
  });
  const link = await page.getByLabel("Your party's link").inputValue();

  // A second browser shares no cookies with the first, like another phone.
  // It takes the project's settings, so it's the same phone, JavaScript off.
  const other = await browser.newContext(
    test.info().project.use as BrowserContextOptions,
  );
  const otherPage = await other.newPage();
  await otherPage.goto(link);

  await expect(
    otherPage.getByRole("heading", { name: cardHeading }),
  ).toBeVisible();
  await expect(otherPage.getByText("Bea, party of 3")).toBeVisible();

  // The link left the party in this browser too: no link needed any more.
  await otherPage.reload();
  await expect(otherPage.getByText("Bea, party of 3")).toBeVisible();
  await other.close();
});

test("lands on the party when an old copy of the form is sent again", async ({
  page,
}) => {
  const email = uniqueEmail("dee");
  await page.goto("/");
  await fillJoinForm(page, { name: "Dee", email });
  await expect(page.getByText("Please choose your party size.")).toBeVisible();
  await fillJoinForm(page, { name: "Dee", email, size: "4" });
  await expect(page.getByText("Dee, party of 4")).toBeVisible();

  // The refused page was the answer to a POST, so going back shows the
  // browser's kept copy of it rather than asking the server again.
  await page.goBack();
  await expect(page).toHaveURL(/\/parties$/);
  await fillJoinForm(page, {
    name: "Eve",
    email: uniqueEmail("eve"),
    size: "1",
  });

  // The browser still holds one party, and it's the one it joined first.
  await expect(page.getByText("Dee, party of 4")).toBeVisible();
  await expect(page.getByText("Eve, party of 1")).toBeHidden();
});

test("leaves after a second tap, then joins again with name and email filled in", async ({
  page,
}) => {
  const email = uniqueEmail("fay");
  await page.goto("/");
  await fillJoinForm(page, { name: "Fay", email, size: "2" });
  await expect(page.getByRole("heading", { name: cardHeading })).toBeVisible();

  // The confirmation is a native disclosure: it opens without JavaScript.
  const leaveButton = page.getByRole("button", { name: "Yes, leave" });
  await expect(leaveButton).toBeHidden();
  await page.getByText("Leave the waitlist").click();
  await leaveButton.click();

  await expect(
    page.getByRole("heading", { name: "You've left the waitlist." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Join the waitlist again" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Fay");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await page.getByLabel("Party size").selectOption("2");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("heading", { name: cardHeading })).toBeVisible();
  await expect(page.getByText("Fay, party of 2")).toBeVisible();
});
