// The card's heading must fit on one line on a small phone in every state:
// a heading that wraps in one state and not the next moves the whole card
// when the live update swaps it in. Each state's heading is put into a card
// on a real page, with the page's real stylesheet, so no party has to be
// walked through every state.
import { expect, test } from "@playwright/test";
import { cardTitles } from "../src/views/messages.js";

// The narrowest phones in common use are 360 CSS pixels wide.
test.use({ viewport: { width: 360, height: 740 } });

test("fits every state's card heading on one line on a small phone", async ({
  page,
}) => {
  await page.goto("/");

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
  }, Object.values(cardTitles));

  for (const title of Object.values(cardTitles)) {
    expect(lines[title], title).toBe(1);
  }
});
