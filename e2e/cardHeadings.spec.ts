// The card's heading must fit on one line on a small phone in each state the
// live update swaps in while the diner watches (waiting to ready, checked in
// to meal over): a heading that wraps in one state and not the next moves the
// whole card. "You've left the waitlist" isn't checked: the diner gets there
// by tapping Leave, on a new page, so nothing moves if it wraps. The page sets
// no font of its own, so how wide a heading is depends on the fonts each
// machine has; this keeps the test to what it guards.
//
// Each state's heading is put into a card on a real page, with the page's
// real stylesheet, so no party has to be walked through every state.
import { expect, test } from "@playwright/test";
import type { PartyState } from "../src/domain/waitlist.js";
import { cardTitles } from "../src/views/messages.js";

// The narrowest phones in common use are 360 CSS pixels wide.
test.use({ viewport: { width: 360, height: 740 } });

const swappedInPlace: PartyState["kind"][] = [
  "waiting",
  "ready",
  "in-service",
  "done",
];

test("fits the heading of every state the live update swaps in on one line on a small phone", async ({
  page,
}) => {
  await page.goto("/");
  const titles = swappedInPlace.map((kind) => cardTitles[kind]);

  const lines = await page.evaluate((titles) => {
    const card = document.createElement("section");
    card.className = "card";
    const heading = document.createElement("h1");
    card.append(heading);
    document.querySelector("main")?.replaceChildren(card);
    const lineHeight = parseFloat(getComputedStyle(heading).lineHeight);
    return Object.fromEntries(
      titles.map((title) => {
        heading.textContent = title;
        return [
          title,
          Math.round(heading.getBoundingClientRect().height / lineHeight),
        ];
      }),
    );
  }, titles);

  for (const title of titles) {
    expect(lines[title], title).toBe(1);
  }
});
