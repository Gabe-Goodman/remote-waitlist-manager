// The pages and form posts, through request() against the real MongoDB from
// Compose, one fresh collection per test. The clock and tokens are fixed,
// except where a test moves its own clock forward.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  maxEmailLength,
  maxNameLength,
  maxPartySize,
} from "../domain/waitlist.js";
import { freshCollection } from "../storage/testDb.js";
import {
  waitlistStore,
  type WaitlistDocument,
  type WaitlistStore,
} from "../storage/waitlistStore.js";
import { waitlistService } from "../services/waitlistService.js";
import { waitlistRoutes } from "./waitlistRoutes.js";

let tokens = 0;
const env = {
  now: () => new Date("2026-11-07T18:00:00Z"),
  newToken: () => `token-${++tokens}`,
};

/** An Environment whose clock the test moves forward by hand. */
function movableClock() {
  let now = env.now();
  return {
    env: { ...env, now: () => now },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function emptyStore() {
  const store = waitlistStore(freshCollection<WaitlistDocument>());
  await store.ensureExists();
  return store;
}

async function routes() {
  return waitlistRoutes(waitlistService(await emptyStore(), env));
}

async function pageHtml(path: string): Promise<string> {
  return (await (await routes()).request(path)).text();
}

/** Submits the join form the way a browser does. */
function postJoin(
  app: Awaited<ReturnType<typeof routes>>,
  fields: Record<string, string>,
  url = "http://localhost/parties",
  headers: Record<string, string> = {},
) {
  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

const ana = { name: "Ana", email: "ana@example.com", size: "2" };

// Some tests silence the expected server-side error log; put it back after
// every test, whether it passed or not.
afterEach(() => {
  vi.restoreAllMocks();
});

// Ten conflicts in a row can't be produced on demand with real MongoDB, so
// only the save is replaced; loading still reads the real waitlist.
function withSavesAlwaysConflicting(store: WaitlistStore): WaitlistStore {
  return { ...store, saveIfVersion: () => Promise.resolve("conflict") };
}

// A database error can't be produced on demand with a healthy MongoDB, so
// only loading is replaced, and it fails the way a dropped connection does.
function withLoadFailing(store: WaitlistStore): WaitlistStore {
  return {
    ...store,
    load: () => Promise.reject(new Error("connection to MongoDB lost")),
  };
}

/** The opening tag of the element with this id. */
function tagWithId(html: string, id: string): string {
  return html.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`))?.[0] ?? "";
}

describe("the join form", () => {
  test("shows the join form to a new diner", async () => {
    const response = await (await routes()).request("/");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toMatch(/<form [^>]*action="\/parties"/);
    expect(html).toMatch(/<form [^>]*method="post"/);
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="size"');
  });

  test("limits the name and email to the domain's lengths", async () => {
    const html = await pageHtml("/");

    expect(tagWithId(html, "name")).toContain(`maxLength="${maxNameLength}"`);
    expect(tagWithId(html, "email")).toContain(`maxLength="${maxEmailLength}"`);
  });

  test("offers party sizes from 1 to the largest party allowed", async () => {
    const html = await pageHtml("/");

    const sizes = [...html.matchAll(/<option value="(\d+)"/g)].map(
      (match) => match[1],
    );
    expect(sizes).toEqual(
      Array.from({ length: maxPartySize }, (_, i) => String(i + 1)),
    );
  });

  test("starts the party size on Choose…, so a diner has to pick one", async () => {
    const html = await pageHtml("/");

    const firstOption =
      html.match(
        /<select [^>]*id="size"[^>]*>(<option[^>]*>[^<]*<\/option>)/,
      )?.[1] ?? "";
    expect(firstOption).toContain('value=""');
    expect(firstOption).toContain("selected");
    expect(firstOption).toContain("disabled");
    expect(firstOption).toContain(">Choose…<");
    expect(tagWithId(html, "size")).toContain("required");
  });

  test("tells phones and screen readers what each field is", async () => {
    const html = await pageHtml("/");

    const name = tagWithId(html, "name");
    const email = tagWithId(html, "email");
    expect(name).toContain('autoComplete="name"');
    expect(name).toContain("required");
    expect(email).toContain('type="email"');
    expect(email).toContain('autoComplete="email"');
    expect(email).toContain("required");
    expect(html).toMatch(/<label for="name">/);
    expect(html).toMatch(/<label for="email">/);
    expect(html).toMatch(/<label for="size">/);
  });
});

describe("joining from the form", () => {
  test("joins and sends the diner to their page", async () => {
    const store = await emptyStore();
    const app = waitlistRoutes(waitlistService(store, env));

    const response = await postJoin(app, ana);

    // Its own page: the address bar is the party's link, ready to share.
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      partyPath(partyCookie(response)),
    );
    const { waitlist } = await store.load();
    expect(waitlist.parties.map((party) => party.name)).toEqual(["Ana"]);
  });

  test("remembers the party in a cookie that scripts and other sites can't use", async () => {
    const store = await emptyStore();

    const response = await postJoin(
      waitlistRoutes(waitlistService(store, env)),
      ana,
    );

    const { waitlist } = await store.load();
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`partyToken=${waitlist.parties[0]?.token};`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=21600");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
  });

  test("marks the cookie Secure when the page is served over HTTPS", async () => {
    const response = await postJoin(
      await routes(),
      ana,
      "https://localhost/parties",
    );

    expect(response.headers.get("Set-Cookie")).toContain("Secure");
  });

  test("keeps what the diner typed and shows each error next to its field", async () => {
    const response = await postJoin(await routes(), {
      name: "Ana",
      email: "not-an-email",
      size: "2",
    });

    expect(response.status).toBe(422);
    const html = await response.text();
    const email = tagWithId(html, "email");
    expect(tagWithId(html, "name")).toContain('value="Ana"');
    expect(email).toContain('value="not-an-email"');
    expect(email).toContain('aria-invalid="true"');
    expect(email).toContain('aria-describedby="email-error"');
    expect(html).toMatch(/<p id="email-error"[^>]*>[^<]+<\/p>/);
    expect(tagWithId(html, "name")).not.toContain("aria-invalid");
  });

  test("says at the top that fields need fixing", async () => {
    const response = await postJoin(await routes(), { ...ana, name: "" });

    const html = await response.text();
    expect(html).toMatch(
      /<div role="alert"[^>]*>Please fix the highlighted fields below\.<\/div>/,
    );
  });

  test("shows the size error when no party size was chosen", async () => {
    const response = await postJoin(await routes(), {
      name: "Ana",
      email: "ana@example.com",
    });

    expect(response.status).toBe(422);
    const html = await response.text();
    expect(tagWithId(html, "size")).toContain('aria-invalid="true"');
    expect(html).toMatch(/<p id="size-error"[^>]*>[^<]+<\/p>/);
  });

  test("refuses a taken email without revealing that party's link", async () => {
    const store = await emptyStore();
    const app = waitlistRoutes(waitlistService(store, env));
    await postJoin(app, ana);
    const { waitlist } = await store.load();
    const anasToken = waitlist.parties[0]?.token ?? "missing";

    const response = await postJoin(app, { ...ana, name: "Someone else" });

    expect(response.status).toBe(409);
    const html = await response.text();
    expect(html).toMatch(/<div role="alert"[^>]*>[^<]+<\/div>/);
    expect(html).not.toContain(anasToken);
  });

  test("sends a browser that already has a party back to it instead of joining again, even with changed details", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const response = await postJoin(
      app,
      { ...ana, name: "Anna", size: "4" },
      "http://localhost/parties",
      { Cookie: anasCookie },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(partyPath(anasCookie));
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await partyPageHtml(app, anasCookie)).toContain("Ana, party of 2");
  });

  test("never gives one browser a second place in the queue", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const response = await postJoin(
      app,
      { name: "Ben", email: "ben@example.com", size: "2" },
      "http://localhost/parties",
      { Cookie: anasCookie },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await (await app.request("/")).text()).toContain(
      "1 party is waiting",
    );
  });

  test("joins normally when the browser's cookie is for a party no longer on the waitlist", async () => {
    const app = await routes();

    const response = await postJoin(app, ana, "http://localhost/parties", {
      Cookie: "partyToken=gone",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      partyPath(partyCookie(response)),
    );
    expect(response.headers.get("Set-Cookie")).toContain("partyToken=");
  });
});

/** The `partyToken=…` part of a Set-Cookie header, ready to send back. */
function partyCookie(response: Response): string {
  return response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

/** Where a party's own page lives, from its cookie ("partyToken=…"). */
function partyPath(cookie: string): string {
  return `/party/${cookie.replace("partyToken=", "")}`;
}

/** The "Join the waitlist again" link of a party, from its cookie. */
function rejoinPath(cookie: string): string {
  return `/?rejoin=${cookie.replace("partyToken=", "")}`;
}

/** The value of the form's hidden joinKey field; undefined if it has none. */
function joinKeyIn(html: string): string | undefined {
  const tag = html.match(/<input [^>]*name="joinKey"[^>]*>/)?.[0];
  if (!tag?.includes('type="hidden"')) return undefined;
  return tag.match(/value="([^"]*)"/)?.[1];
}

describe("double taps", () => {
  test("lands a double tap on the same party", async () => {
    const app = await routes();
    const form = { ...ana, joinKey: "key-1" };

    const first = await postJoin(app, form);
    const second = await postJoin(app, form);

    for (const response of [first, second]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(
        partyPath(partyCookie(first)),
      );
    }
    expect(partyCookie(first)).toMatch(/^partyToken=.+/);
    expect(partyCookie(second)).toBe(partyCookie(first));
    expect(await (await app.request("/")).text()).toContain(
      "1 party is waiting",
    );
  });

  test("gives each fresh form a new join key", async () => {
    const app = await routes();

    const first = joinKeyIn(await (await app.request("/")).text());
    const second = joinKeyIn(await (await app.request("/")).text());

    expect(first).toMatch(/.+/);
    expect(second).toMatch(/.+/);
    expect(second).not.toBe(first);
  });

  test("keeps the join key when the form comes back with errors", async () => {
    const response = await postJoin(await routes(), {
      ...ana,
      email: "not-an-email",
      joinKey: "key-x",
    });

    expect(response.status).toBe(422);
    expect(joinKeyIn(await response.text())).toBe("key-x");
  });
});

describe("your place in the queue", () => {
  test("shows your place after joining", async () => {
    const app = await routes();
    // Ben's 9 seats leave too few for Ana, so she waits behind him.
    await postJoin(app, {
      name: "Ben",
      email: "ben@example.com",
      size: "9",
    });
    const joined = await postJoin(app, ana);

    const response = await app.request(partyPath(partyCookie(joined)));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Ana");
    expect(html).toContain("1 party ahead of you");
    expect(html).toContain("Ana, party of 2");
    expect(html).not.toMatch(/<form [^>]*action="\/parties"/);
  });

  test("shows the join form and clears the cookie when the party is unknown", async () => {
    const response = await (
      await routes()
    ).request("/", {
      headers: { Cookie: "partyToken=token-nobody" },
    });

    expect(await response.text()).toMatch(/<form [^>]*action="\/parties"/);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("partyToken=;");
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("the party's link", () => {
  test("shows a party's page at its link in another browser, which can still join its own", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const opened = await app.request(partyPath(anasCookie));
    const home = await app.request("/");

    expect(opened.status).toBe(200);
    expect(await opened.text()).toContain("Ana, party of 2");
    // Only joining makes a party this browser's own: a friend's phone that
    // opened the link before joining still gets the join form at /.
    expect(opened.headers.get("Set-Cookie")).toBeNull();
    expect(home.status).toBe(200);
    expect(await home.text()).toMatch(/<form [^>]*action="\/parties"/);
  });

  test("sends a browser that has a party from / to that party's page", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const home = await app.request("/", { headers: { Cookie: anasCookie } });

    expect(home.status).toBe(303);
    expect(home.headers.get("Location")).toBe(partyPath(anasCookie));
  });

  test("shows a friend's party at its link, and keeps this browser's own party", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    const bensCookie = partyCookie(
      await postJoin(app, { ...ana, name: "Ben", email: "ben@example.com" }),
    );

    const opened = await app.request(partyPath(anasCookie), {
      headers: { Cookie: bensCookie },
    });

    expect(opened.status).toBe(200);
    expect(await opened.text()).toContain("Ana, party of 2");
    expect(opened.headers.get("Set-Cookie")).toBeNull();
    expect(await partyPageHtml(app, bensCookie)).toContain("Ben, party of 2");
  });

  test("sends an unknown link to the join form", async () => {
    const response = await (await routes()).request("/party/nope");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  test("shows the party's full link on its card, ready to copy, with who can use it", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    const anasToken = anasCookie.replace("partyToken=", "");

    const card = await partyPageHtml(app, anasCookie);
    const joinForm = await (await app.request("/")).text();

    const field = /<input id="party-link"[^>]*>/.exec(card)?.[0] ?? "";
    expect(field).toContain('readOnly=""');
    expect(field).toContain(`value="http://localhost/party/${anasToken}"`);
    expect(field).toContain('aria-describedby="party-link-hint"');
    expect(card).toContain(
      '<label for="party-link">Your party&#x27;s link</label>',
    );
    expect(card).toContain(
      '<p id="party-link-hint" class="secondary">Share it with the rest of your party, or open it on another device. Anyone with this link can see your place on the waitlist, and check in or leave for you.</p>',
    );
    expect(card).not.toContain("sms:");
    expect(card).not.toContain("mailto:");
    expect(joinForm).not.toContain("/party/");
  });

  test("puts the link's field and Copy button in a <copy-link> island, with its script in the page's head", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const page = await partyPageHtml(app, anasCookie);
    const card = await (await getCard(app, anasCookie)).text();

    const head = /<head>[\s\S]*<\/head>/.exec(page)?.[0] ?? "";
    const copyLinkJs = readFileSync("browser/copyLink.js", "utf8");
    expect(head.includes(copyLinkJs)).toBe(true);
    // Everything the island uses is inside it: the field, the button and
    // the status it announces, found without ids.
    const island = /<copy-link>[\s\S]*?<\/copy-link>/.exec(card)?.[0] ?? "";
    expect(island).toMatch(/^<copy-link><input id="party-link"/);
    expect(island).toMatch(
      /<button type="button" class="custom" aria-label="Copy link"><svg aria-hidden="true"/,
    );
    // The wording lives in messages.ts and reaches the script through the
    // island, so the script itself holds no text a diner reads.
    expect(island).toContain(
      '<span role="status" class="visually-hidden" data-copied-text="Link copied"></span>',
    );
    expect(card).not.toContain("<script");
  });
});

/** Posts the card's Check-in button, the way a browser does. */
/** Posts the card's Check-in button: it acts on the party in the URL. */
function postCheckIn(app: Hono, cookie: string, browserCookie?: string) {
  return app.request(`${partyPath(cookie)}/check-in`, {
    method: "POST",
    headers: browserCookie ? { Cookie: browserCookie } : {},
  });
}

/** This browser's page, as a browser gets it: / sends it to its party's page. */
async function partyPageHtml(app: Hono, cookie: string): Promise<string> {
  const headers = { Cookie: cookie };
  const home = await app.request("/", { headers });
  const location = home.headers.get("Location");
  if (home.status !== 303 || !location) return home.text();
  return (await app.request(location, { headers })).text();
}

describe("checking in", () => {
  test("shows a party whose table is ready the Check-in button", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const html = await partyPageHtml(app, anasCookie);

    expect(html).toContain("<title>Your table is ready!</title>");
    expect(html).toContain("<h1>Your table is ready!</h1>");
    // Checking in starts the table's clock, so the card sends the diner to
    // the host stand first: the party's details the host confirms are right
    // under the line, and the Check-in button right under them. No time
    // limit: the table is held until the party checks in or leaves.
    expect(html).toContain(
      '<p class="ahead">See your host.</p><p>Ana, party of 2</p>',
    );
    expect(html).not.toContain("Check in now");
    expect(html).not.toContain("hold it for");
    expect(html).toContain(
      `<form action="${partyPath(anasCookie)}/check-in" method="post"><button type="submit">Check in</button></form>`,
    );
  });

  test("tells the party at the front that it's next", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, { ...ana, size: "6" }));
    await postCheckIn(app, anasCookie);
    // Ana's 6 seats are in service, so Ben's 5 don't fit: he waits, first.
    const bensCookie = partyCookie(
      await postJoin(app, { name: "Ben", email: "ben@example.com", size: "5" }),
    );

    const html = await partyPageHtml(app, bensCookie);

    expect(html).toContain("<h1>You&#x27;re on the waitlist</h1>");
    // Short enough to read at a glance; the join page already says to keep
    // the page open.
    expect(html).toContain(
      '<p class="ahead">You&#x27;re next. Stay close.</p>',
    );
    expect(html).not.toContain("ahead of you");
    expect(html).not.toContain('/check-in"');
  });

  test("checks in from the card and shows the party as checked in", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const response = await postCheckIn(app, anasCookie);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(partyPath(anasCookie));
    const html = await partyPageHtml(app, anasCookie);
    expect(html).toContain("<title>You&#x27;re checked in</title>");
    expect(html).toContain("<h1>You&#x27;re checked in</h1>");
    // With the host and being seated: the card can just be warm. No clock
    // on the meal: nobody likes being timed at dinner.
    expect(html).toContain('<p class="ahead">Enjoy your meal.</p>');
    expect(html).toContain("Ana, party of 2");
    expect(html).not.toContain('/check-in"');
  });

  test("sends a second check-in to the checked-in card", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const first = await postCheckIn(app, anasCookie);
    const second = await postCheckIn(app, anasCookie);

    for (const response of [first, second]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe(partyPath(anasCookie));
    }
    expect(await partyPageHtml(app, anasCookie)).toContain(
      "<h1>You&#x27;re checked in</h1>",
    );
  });

  test("sends a check-in for a party that isn't on the waitlist to the join form", async () => {
    const store = await emptyStore();
    const app = waitlistRoutes(waitlistService(store, env));

    const response = await postCheckIn(app, "partyToken=gone");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
    expect((await store.load()).waitlist.parties).toEqual([]);
  });

  test("checks in the party on the page, even from another party's browser", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    const bensCookie = partyCookie(
      await postJoin(app, { name: "Ben", email: "ben@example.com", size: "2" }),
    );

    // Ben's phone, on Ana's page, taps Ana's Check-in button.
    await postCheckIn(app, anasCookie, bensCookie);

    expect(await partyPageHtml(app, anasCookie)).toContain(
      "<h1>You&#x27;re checked in</h1>",
    );
    expect(await partyPageHtml(app, bensCookie)).toContain(
      "<h1>Your table is ready!</h1>",
    );
  });

  test("says thanks once the meal is over, without the party's link", async () => {
    const clock = movableClock();
    const app = waitlistRoutes(waitlistService(await emptyStore(), clock.env));
    const anasCookie = partyCookie(await postJoin(app, ana));
    await postCheckIn(app, anasCookie);

    // A party of 2 is served for 2 × 3 seconds.
    clock.advance(6000);
    const html = await partyPageHtml(app, anasCookie);

    expect(html).toContain("<title>Thanks for dining</title>");
    expect(html).toContain("<h1>Thanks for dining</h1>");
    expect(html).toContain("Ana, party of 2");
    expect(html).not.toContain('id="party-link"');
  });

  test("lets a browser whose party has finished join again", async () => {
    const clock = movableClock();
    const app = waitlistRoutes(waitlistService(await emptyStore(), clock.env));
    const anasCookie = partyCookie(await postJoin(app, ana));
    await postCheckIn(app, anasCookie);
    clock.advance(6000);

    const response = await postJoin(
      app,
      { ...ana, email: "ana.again@example.com" },
      "http://localhost/parties",
      { Cookie: anasCookie },
    );

    expect(response.status).toBe(303);
    const newCookie = partyCookie(response);
    expect(newCookie).toMatch(/^partyToken=.+/);
    expect(newCookie).not.toBe(anasCookie);
  });
});

describe("joining again", () => {
  /** A browser whose party of 2 has checked in, and the clock it runs on. */
  async function checkedInParty() {
    const clock = movableClock();
    const app = waitlistRoutes(waitlistService(await emptyStore(), clock.env));
    const anasCookie = partyCookie(await postJoin(app, ana));
    await postCheckIn(app, anasCookie);
    return { app, clock, anasCookie };
  }

  test("offers a finished party a link to join the waitlist again", async () => {
    const { app, clock, anasCookie } = await checkedInParty();
    // A party of 2 is served for 2 × 3 seconds.
    clock.advance(6000);

    const html = await partyPageHtml(app, anasCookie);

    expect(html).toContain(
      `<a href="${rejoinPath(anasCookie)}">Join the waitlist again</a>`,
    );
    expect(html).not.toContain("<button");
  });

  test("shows a finished party the join form with its name and email, without forgetting its party", async () => {
    const { app, clock, anasCookie } = await checkedInParty();
    clock.advance(6000);

    const response = await app.request(rejoinPath(anasCookie), {
      headers: { Cookie: anasCookie },
    });

    const html = await response.text();
    expect(html).toMatch(/<form [^>]*action="\/parties"/);
    expect(tagWithId(html, "name")).toContain('value="Ana"');
    expect(tagWithId(html, "email")).toContain('value="ana@example.com"');
    // The group may have changed, so the size is asked again.
    expect(html).toMatch(/<option value="" disabled="" selected="">/);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await partyPageHtml(app, anasCookie)).toContain(
      "<h1>Thanks for dining</h1>",
    );
  });

  test("fills in the join-again form only for the browser that joined as the party", async () => {
    const { app, clock, anasCookie } = await checkedInParty();
    const bensCookie = partyCookie(
      await postJoin(app, { ...ana, name: "Ben", email: "ben@example.com" }),
    );
    clock.advance(6000);

    // A friend's phone that opened Ana's link, or a private window.
    const noParty = await app.request(rejoinPath(anasCookie));
    // A friend whose own party is still waiting, on Ana's finished card.
    const friendWithParty = await app.request(rejoinPath(anasCookie), {
      headers: { Cookie: bensCookie },
    });

    for (const response of [noParty, friendWithParty]) {
      expect(response.status).toBe(200);
      const form = await response.text();
      expect(form).toMatch(/<form [^>]*action="\/parties"/);
      expect(tagWithId(form, "name")).toContain('value=""');
      expect(form).not.toContain("ana@example.com");
    }
  });

  test("gives the join-again form a new join key", async () => {
    const { app, clock, anasCookie } = await checkedInParty();
    clock.advance(6000);

    const response = await app.request(rejoinPath(anasCookie), {
      headers: { Cookie: anasCookie },
    });

    expect(joinKeyIn(await response.text())).toMatch(/.+/);
  });

  test("doesn't fill the form from a party that still holds a place", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const ownBrowser = await app.request(rejoinPath(anasCookie), {
      headers: { Cookie: anasCookie },
    });
    const otherBrowser = await app.request(rejoinPath(anasCookie));

    // Its own browser goes to its page; anyone else gets the plain form.
    expect(ownBrowser.status).toBe(303);
    expect(ownBrowser.headers.get("Location")).toBe(partyPath(anasCookie));
    const form = await otherBrowser.text();
    expect(tagWithId(form, "name")).toContain('value=""');
    expect(form).not.toContain("ana@example.com");
  });

  test("shows the plain join form for a link to a party that isn't on the waitlist", async () => {
    const response = await (await routes()).request("/?rejoin=nobody");

    expect(response.status).toBe(200);
    expect(tagWithId(await response.text(), "name")).toContain('value=""');
  });

  test("has no separate join-again page", async () => {
    const response = await (await routes()).request("/join-again");

    expect(response.status).toBe(404);
  });
});

/** Posts the card's "Yes, leave" button, the way a browser does. */
function postLeave(app: Hono, cookie: string) {
  return app.request(`${partyPath(cookie)}/leave`, { method: "POST" });
}

describe("leaving", () => {
  const leaveControl = (cookie: string) =>
    `<details class="leave"><summary>Leave the waitlist</summary><p>Your place can&#x27;t be restored. If you join again, you&#x27;ll go to the back of the waitlist.</p><form action="${partyPath(cookie)}/leave" method="post"><button type="submit" data-variant="danger">Yes, leave</button></form></details>`;

  test("offers a waiting or ready party a way to leave, behind a second tap", async () => {
    const app = await routes();
    const cysCookie = partyCookie(
      await postJoin(app, { name: "Cy", email: "cy@example.com", size: "2" }),
    );
    await postCheckIn(app, cysCookie);
    // Cy's 2 seats are in service; Ana's 8 fit, Ben's 3 don't.
    const anasCookie = partyCookie(await postJoin(app, { ...ana, size: "8" }));
    const bensCookie = partyCookie(
      await postJoin(app, { name: "Ben", email: "ben@example.com", size: "3" }),
    );

    const ready = await partyPageHtml(app, anasCookie);
    const waiting = await partyPageHtml(app, bensCookie);
    const checkedIn = await partyPageHtml(app, cysCookie);

    expect(ready).toContain("<h1>Your table is ready!</h1>");
    expect(ready).toContain(leaveControl(anasCookie));
    expect(waiting).toContain("<h1>You&#x27;re on the waitlist</h1>");
    expect(waiting).toContain(leaveControl(bensCookie));
    expect(checkedIn).toContain("<h1>You&#x27;re checked in</h1>");
    expect(checkedIn).not.toContain('/leave"');
  });

  test("takes the party off the waitlist and shows that it left", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const response = await postLeave(app, anasCookie);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(partyPath(anasCookie));
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const card = await partyPageHtml(app, anasCookie);
    expect(card).toContain("<title>You&#x27;ve left the waitlist</title>");
    expect(card).toContain("<h1>You&#x27;ve left the waitlist</h1>");
    expect(card).toContain("Ana, party of 2");
    expect(card).not.toContain('id="party-link"');
    expect(card).not.toContain('/leave"');
    expect(card).toContain(
      `<a href="${rejoinPath(anasCookie)}">Join the waitlist again</a>`,
    );
    expect(await (await app.request("/")).text()).toContain(
      "No one is waiting right now.",
    );
  });

  test("sends a refused leave back to the party's page, or to / for an unknown party", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    await postCheckIn(app, anasCookie);

    const noParty = await postLeave(app, "partyToken=gone");
    const checkedIn = await postLeave(app, anasCookie);

    expect(noParty.headers.get("Location")).toBe("/");
    expect(checkedIn.headers.get("Location")).toBe(partyPath(anasCookie));
    for (const response of [noParty, checkedIn]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
    expect(await partyPageHtml(app, anasCookie)).toContain(
      "<h1>You&#x27;re checked in</h1>",
    );
  });

  test("lets a party that left join again at the back, with its name and email filled in", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, { ...ana, size: "8" }));
    const bensCookie = partyCookie(
      await postJoin(app, { name: "Ben", email: "ben@example.com", size: "3" }),
    );
    await postLeave(app, anasCookie);

    const form = await (
      await app.request(rejoinPath(anasCookie), {
        headers: { Cookie: anasCookie },
      })
    ).text();
    const rejoined = await postJoin(
      app,
      { ...ana, size: "8", joinKey: joinKeyIn(form) ?? "" },
      "http://localhost/parties",
      { Cookie: anasCookie },
    );

    expect(tagWithId(form, "name")).toContain('value="Ana"');
    expect(tagWithId(form, "email")).toContain('value="ana@example.com"');
    expect(rejoined.status).toBe(303);
    const newCookie = partyCookie(rejoined);
    expect(newCookie).toMatch(/^partyToken=.+/);
    expect(newCookie).not.toBe(anasCookie);
    expect(await partyPageHtml(app, newCookie)).toContain(
      "1 party ahead of you.",
    );
    expect(await partyPageHtml(app, bensCookie)).toContain(
      "<h1>Your table is ready!</h1>",
    );
  });

  test("frees a ready party's seats for the next party when it leaves", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, { ...ana, size: "8" }));
    const bensCookie = partyCookie(
      await postJoin(app, { name: "Ben", email: "ben@example.com", size: "3" }),
    );
    expect(await partyPageHtml(app, bensCookie)).toContain(
      "<h1>You&#x27;re on the waitlist</h1>",
    );

    await postLeave(app, anasCookie);

    expect(await partyPageHtml(app, bensCookie)).toContain(
      "<h1>Your table is ready!</h1>",
    );
  });
});

/** The party's card on its own, the way the card's live updates fetch it. */
function getCard(app: Hono, cookie: string) {
  return app.request(`${partyPath(cookie)}/card`);
}

describe("the card on its own", () => {
  test("sends just the party's card, the same one the page shows", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const response = await getCard(app, anasCookie);
    const card = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(card).not.toMatch(/^<!DOCTYPE/i);
    expect(card).not.toContain("<html");
    expect(card).not.toContain("<style");
    expect(card).toMatch(
      /^<section class="card" data-state="ready" data-title="Your table is ready!">[\s\S]*<\/section>$/,
    );
    const page = await partyPageHtml(app, anasCookie);
    expect(page.match(/<section class="card"[\s\S]*?<\/section>/)?.[0]).toBe(
      card,
    );
  });

  test("follows the party's state", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    await postCheckIn(app, anasCookie);

    const card = await (await getCard(app, anasCookie)).text();

    expect(card).toContain("You&#x27;re checked in");
    // The card carries its own title, so the live update can set the tab's.
    expect(card).toMatch(
      /^<section class="card" data-state="in-service" data-title="You&#x27;re checked in">/,
    );
  });

  test("wraps the card in a <live-card> island that fetches the party's own card", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    const anasToken = anasCookie.replace("partyToken=", "");

    const page = await partyPageHtml(app, anasCookie);
    const card = await (await getCard(app, anasCookie)).text();

    const head = /<head>[\s\S]*<\/head>/.exec(page)?.[0] ?? "";
    const liveCardJs = readFileSync("browser/liveCard.js", "utf8");
    expect(head.includes(liveCardJs)).toBe(true);
    // The island is told where its card comes from, rather than working it
    // out from the page's address.
    expect(page).toContain(
      `<live-card src="/party/${anasToken}/card"><section class="card"`,
    );
    // The card it fetches is the card alone, swapped in inside the island.
    expect(card).not.toContain("live-card");
    expect(card).not.toContain("<script");
  });

  test("brings each island's script to exactly the pages that show the island", async () => {
    const clock = movableClock();
    const app = waitlistRoutes(waitlistService(await emptyStore(), clock.env));
    const anasCookie = partyCookie(await postJoin(app, ana));
    await postCheckIn(app, anasCookie);
    // A party of 2 is served for 2 × 3 seconds.
    clock.advance(6000);

    const finished = await partyPageHtml(app, anasCookie);
    const joinForm = await (await app.request("/")).text();
    const liveCardJs = readFileSync("browser/liveCard.js", "utf8");
    const copyLinkJs = readFileSync("browser/copyLink.js", "utf8");

    // A finished party's page shows the live card but has no link to copy,
    // so it gets the live card's script and not the Copy button's.
    const body = /<body>[\s\S]*<\/body>/.exec(finished)?.[0] ?? "";
    expect(body).toContain("<live-card");
    expect(body).not.toContain("<copy-link");
    expect(finished.includes(liveCardJs)).toBe(true);
    expect(finished.includes(copyLinkJs)).toBe(false);
    // The join form shows no islands, so it gets no script.
    expect(joinForm).not.toContain("<script");
  });

  test("sends nothing for a party that isn't on the waitlist", async () => {
    const response = await getCard(await routes(), "partyToken=nobody");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  test("tells browsers not to keep the card", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const response = await getCard(app, anasCookie);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("the waiting count before joining", () => {
  async function formAfterJoining(names: string[]): Promise<string> {
    const app = await routes();
    for (const name of names) {
      await postJoin(app, {
        name,
        email: `${name.toLowerCase()}@example.com`,
        size: "2",
      });
    }
    return (await app.request("/")).text();
  }

  test("says no one is waiting when the waitlist is empty", async () => {
    const html = await formAfterJoining([]);

    expect(html).toContain("No one is waiting right now");
  });

  test("says 1 party is waiting", async () => {
    const html = await formAfterJoining(["Ben"]);

    expect(html).toContain("1 party is waiting");
  });

  test("says how many parties are waiting, never who", async () => {
    const html = await formAfterJoining(["Ben", "Cy", "Dee"]);

    expect(html).toContain("3 parties are waiting");
    expect(html).not.toContain("Ben");
    expect(html).not.toContain("Cy");
    expect(html).not.toContain("Dee");
  });
});

describe("when joining can't go through", () => {
  test("asks the diner to tap Join again when the waitlist is busy, keeping what they typed", async () => {
    const app = waitlistRoutes(
      waitlistService(withSavesAlwaysConflicting(await emptyStore()), env),
    );

    const response = await postJoin(app, ana);

    expect(response.status).toBe(409);
    const html = await response.text();
    expect(html).toMatch(
      /<div role="alert"[^>]*>Lots of people are joining right now\. Please tap Join again\.<\/div>/,
    );
    expect(tagWithId(html, "name")).toContain('value="Ana"');
    expect(tagWithId(html, "email")).toContain('value="ana@example.com"');
  });
});

describe("when something goes wrong", () => {
  test("shows a friendly page when the database fails, without the error's details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = waitlistRoutes(
      waitlistService(withLoadFailing(await emptyStore()), env),
    );

    const response = await app.request("/");

    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).toContain('<a href="/">Try again</a>');
    expect(html).not.toContain("connection to MongoDB lost");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ message: "connection to MongoDB lost" }),
    );
  });

  test("tries again where the diner was: the same page, or the party an action was for", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = waitlistRoutes(
      waitlistService(withLoadFailing(await emptyStore()), env),
    );
    const tryAgain = async (path: string, method = "GET") =>
      /<a href="([^"]*)">Try again<\/a>/.exec(
        await (await app.request(path, { method })).text(),
      )?.[1];

    // A page loads again; a friend's link brings the party back.
    expect(await tryAgain("/party/abc")).toBe("/party/abc");
    expect(await tryAgain("/?rejoin=abc")).toBe("/?rejoin=abc");
    // An action isn't repeated: the party's page shows what happened.
    expect(await tryAgain("/party/abc/check-in", "POST")).toBe("/party/abc");
    expect(await tryAgain("/party/abc/leave", "POST")).toBe("/party/abc");
    expect(await tryAgain("/parties", "POST")).toBe("/");
  });

  test("shows the friendly page when the routes are mounted in another app", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono().route(
      "/",
      waitlistRoutes(waitlistService(withLoadFailing(await emptyStore()), env)),
    );

    const response = await app.request("/");

    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).toContain('<a href="/">Try again</a>');
  });
});

describe("oversized form posts", () => {
  test("lets the largest valid form join", async () => {
    // 50 Japanese characters: 3 bytes each in UTF-8, 9 once URL-encoded,
    // the heaviest name the form allows.
    const local = "a".repeat(64);
    const largest = {
      name: "あ".repeat(maxNameLength),
      email: `${local}@${"b".repeat(maxEmailLength - local.length - 5)}.com`,
      size: String(maxPartySize),
    };
    const response = await postJoin(await routes(), largest);

    expect(response.status).toBe(303);
  });

  test("refuses a form post larger than 10 KB without saving anything", async () => {
    const store = await emptyStore();
    const app = waitlistRoutes(waitlistService(store, env));

    const response = await postJoin(app, {
      ...ana,
      name: "x".repeat(11 * 1024),
    });

    expect(response.status).toBe(413);
    expect(await store.load()).toEqual({
      waitlist: { parties: [] },
      version: 0,
    });
  });

  test("applies the limit to every POST, not only joining", async () => {
    const response = await postJoin(
      await routes(),
      { ...ana, name: "x".repeat(11 * 1024) },
      "http://localhost/any-other-post",
    );

    expect(response.status).toBe(413);
  });
});

describe("the back button", () => {
  test("tells browsers not to keep any page, so going back shows the current state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    const bensCookie = partyCookie(
      await postJoin(app, { ...ana, name: "Ben", email: "ben@example.com" }),
    );
    const failing = waitlistRoutes(
      waitlistService(withLoadFailing(await emptyStore()), env),
    );

    const pages = {
      "join form": await app.request("/"),
      "party card": await app.request(partyPath(bensCookie)),
      "another party's page": await app.request(partyPath(anasCookie), {
        headers: { Cookie: bensCookie },
      }),
      "error page": await failing.request("/"),
    };

    for (const [page, response] of Object.entries(pages)) {
      expect(response.headers.get("Cache-Control"), page).toBe("no-store");
    }
  });

  test("lets the browser keep a refused join's page, so going back doesn't ask to resubmit the form", async () => {
    const response = await postJoin(await routes(), { ...ana, email: "nope" });

    expect(response.headers.get("Cache-Control")).toBeNull();
  });
});

describe("styling", () => {
  test("carries TableKit's stylesheet and the page's own in every page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tablekitCss = readFileSync(
      createRequire(import.meta.url).resolve(
        "@tablecheck/tablekit-css/tablekit.classless.min.css",
      ),
      "utf8",
    );
    const pageCss = readFileSync("browser/page.css", "utf8");
    const app = await routes();
    const joined = await postJoin(app, ana);
    const failing = waitlistRoutes(
      waitlistService(withLoadFailing(await emptyStore()), env),
    );

    const pages = {
      "join form": await app.request("/"),
      "refused join": await postJoin(app, { ...ana, email: "nope" }),
      "party card": await app.request(partyPath(partyCookie(joined))),
      "error page": await failing.request("/"),
    };

    for (const [page, response] of Object.entries(pages)) {
      // includes() rather than toContain(): a failure would print all 115 KB.
      const html = await response.text();
      expect(html.includes(`<style>${tablekitCss}</style>`), page).toBe(true);
      expect(html.includes(`<style>${pageCss}</style>`), page).toBe(true);
    }
  });

  test("marks each invalid field for screen readers and for TableKit", async () => {
    const response = await postJoin(await routes(), {
      name: "Ana",
      email: "nope",
    });

    const html = await response.text();
    for (const field of ["email", "size"]) {
      const tag = tagWithId(html, field);
      expect(tag, field).toContain('aria-invalid="true"');
      expect(tag, field).toContain('data-variant="error"');
    }
    expect(tagWithId(html, "name")).not.toContain("aria-invalid");
    expect(tagWithId(html, "name")).not.toContain("data-variant");
  });

  test("shows each field's error as text under the field, not a box", async () => {
    const response = await postJoin(await routes(), { ...ana, email: "nope" });

    expect(tagWithId(await response.text(), "email-error")).toBe(
      '<p id="email-error" class="field-error">',
    );
  });

  test("shows the notice in a TableKit alert: error, or warning when busy", async () => {
    const store = await emptyStore();
    const app = waitlistRoutes(waitlistService(store, env));
    await postJoin(app, ana);
    const busy = waitlistRoutes(
      waitlistService(withSavesAlwaysConflicting(store), env),
    );

    const notices = {
      error: await postJoin(app, { ...ana, name: "" }),
      duplicate: await postJoin(app, ana),
      busy: await postJoin(busy, { ...ana, email: "ben@example.com" }),
    };

    const variant = async (response: Response) =>
      (await response.text()).match(
        /<div role="alert" class="alert" data-variant="([a-z]+)"/,
      )?.[1];
    expect(await variant(notices.error)).toBe("error");
    expect(await variant(notices.duplicate)).toBe("error");
    expect(await variant(notices.busy)).toBe("warning");
  });
});

describe("compression", () => {
  test("sends pages gzipped when the browser accepts it", async () => {
    const app = await routes();

    const response = await app.request("/", {
      headers: { "Accept-Encoding": "gzip" },
    });

    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    const unzipped = response.body?.pipeThrough(
      new DecompressionStream("gzip"),
    );
    expect(await new Response(unzipped).text()).toMatch(/^<!DOCTYPE html>/);
  });

  test("sends pages uncompressed when the browser doesn't accept gzip", async () => {
    const response = await (await routes()).request("/");

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(await response.text()).toMatch(/^<!DOCTYPE html>/);
  });
});

describe("icons", () => {
  /** The card's state icon: last in the panel that says where you stand. */
  function stateIcon(html: string): string | undefined {
    return html.match(
      /<div class="place"><div>.*?<\/div><svg [^>]*data-icon="([a-z]+)"[^>]*>.*?<\/svg><\/div>/,
    )?.[1];
  }

  test("shows an icon beside where the party stands while something is happening", async () => {
    const clock = movableClock();
    const app = waitlistRoutes(waitlistService(await emptyStore(), clock.env));
    const anasCookie = partyCookie(await postJoin(app, { ...ana, size: "6" }));
    // Ana's 6 seats are held, so Ben's 5 don't fit: he waits.
    const bensCookie = partyCookie(
      await postJoin(app, { name: "Ben", email: "ben@example.com", size: "5" }),
    );

    expect(stateIcon(await partyPageHtml(app, anasCookie))).toBe("bell");
    expect(stateIcon(await partyPageHtml(app, bensCookie))).toBe("hourglass");
    await postCheckIn(app, anasCookie);
    expect(stateIcon(await partyPageHtml(app, anasCookie))).toBe("restaurant");
    // A party of 6 is served for 6 × 3 seconds.
  });

  test("shows no icon once the visit is over: the heading says it", async () => {
    const clock = movableClock();
    const app = waitlistRoutes(waitlistService(await emptyStore(), clock.env));
    const anasCookie = partyCookie(await postJoin(app, ana));
    const bensCookie = partyCookie(
      await postJoin(app, { name: "Ben", email: "ben@example.com", size: "2" }),
    );
    await postCheckIn(app, anasCookie);
    // A party of 2 is served for 2 × 3 seconds.
    clock.advance(6000);
    await postLeave(app, bensCookie);

    for (const cookie of [anasCookie, bensCookie]) {
      const html = await partyPageHtml(app, cookie);
      // The panel holds only its words: no icon after them.
      expect(html).toMatch(
        /<div class="place"><div><p>[^<]*<\/p><\/div><\/div>/,
      );
    }
  });

  test("keeps the card's words as they are, with the icon hidden from screen readers", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const html = await partyPageHtml(app, anasCookie);

    expect(html).toContain("<h1>Your table is ready!</h1>");
    expect(html).toContain('<p class="ahead">See your host.</p>');
    expect(html).toMatch(
      /<div class="place"><div>.*?<\/div><svg aria-hidden="true" focusable="false"/,
    );
  });

  test("labels the join form's fields with words only: the phone already fills in and explains them", async () => {
    const html = await pageHtml("/");

    expect(html).toContain('<label for="name">Name</label>');
    expect(html).toContain('<label for="email">Email</label>');
    expect(html).toContain('<label for="size">Party size</label>');
  });
});
