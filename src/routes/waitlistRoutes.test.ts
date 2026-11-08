// The pages and form posts, through request() against the real MongoDB from
// Compose, one fresh collection per test. The clock and tokens are fixed.
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
import { waitlistRoutes } from "./waitlistRoutes.js";

let tokens = 0;
const env = {
  now: () => new Date("2026-11-07T18:00:00Z"),
  newToken: () => `token-${++tokens}`,
};

async function emptyStore() {
  const store = waitlistStore(freshCollection<WaitlistDocument>());
  await store.ensureExists();
  return store;
}

async function routes() {
  return waitlistRoutes(await emptyStore(), env);
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
    const app = waitlistRoutes(store, env);

    const response = await postJoin(app, ana);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
    const { waitlist } = await store.load();
    expect(waitlist.parties.map((party) => party.name)).toEqual(["Ana"]);
  });

  test("remembers the party in a cookie that scripts and other sites can't use", async () => {
    const store = await emptyStore();

    const response = await postJoin(waitlistRoutes(store, env), ana);

    const { waitlist } = await store.load();
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`party=${waitlist.parties[0]?.token};`);
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
    const app = waitlistRoutes(store, env);
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
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const card = await app.request("/", { headers: { Cookie: anasCookie } });
    expect(await card.text()).toContain("Ana, party of 2");
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
      Cookie: "party=gone",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toContain("party=");
  });
});

/** The `party=…` part of a Set-Cookie header, ready to send back. */
function partyCookie(response: Response): string {
  return response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

describe("your place in the queue", () => {
  test("shows your place after joining", async () => {
    const app = await routes();
    await postJoin(app, { ...ana, name: "Ben", email: "ben@example.com" });
    const joined = await postJoin(app, ana);

    const response = await app.request("/", {
      headers: { Cookie: partyCookie(joined) },
    });

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
      headers: { Cookie: "party=token-nobody" },
    });

    expect(await response.text()).toMatch(/<form [^>]*action="\/parties"/);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("party=;");
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("the party's link", () => {
  test("opens a party from its link in another browser, and remembers it there", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    const anasToken = anasCookie.replace("party=", "");

    const opened = await app.request(`/party/${anasToken}`);

    expect(opened.status).toBe(303);
    expect(opened.headers.get("Location")).toBe("/");
    expect(partyCookie(opened)).toBe(anasCookie);
    const page = await app.request("/", {
      headers: { Cookie: partyCookie(opened) },
    });
    expect(await page.text()).toContain("Ana, party of 2");
  });

  test("never replaces this browser's own party with someone else's link", async () => {
    const app = await routes();
    const anasToken = partyCookie(await postJoin(app, ana)).replace(
      "party=",
      "",
    );
    const bensCookie = partyCookie(
      await postJoin(app, { ...ana, name: "Ben", email: "ben@example.com" }),
    );
    const bensToken = bensCookie.replace("party=", "");

    const opened = await app.request(`/party/${anasToken}`, {
      headers: { Cookie: bensCookie },
    });

    expect(opened.status).toBe(200);
    expect(opened.headers.get("Set-Cookie")).toBeNull();
    const html = await opened.text();
    expect(html).toContain("Ben, party of 2");
    expect(html).not.toContain("Ana, party of 2");
    expect(html).toContain(`value="http://localhost/party/${bensToken}"`);
  });

  test("explains that this browser keeps its own party when another party's link is opened", async () => {
    const app = await routes();
    const anasToken = partyCookie(await postJoin(app, ana)).replace(
      "party=",
      "",
    );
    const bensCookie = partyCookie(
      await postJoin(app, { ...ana, name: "Ben", email: "ben@example.com" }),
    );
    const notice =
      "You&#x27;re already on the waitlist. To see another party&#x27;s place, open their link on another phone or browser.";

    const opened = await (
      await app.request(`/party/${anasToken}`, {
        headers: { Cookie: bensCookie },
      })
    ).text();
    const ownPage = await (
      await app.request("/", { headers: { Cookie: bensCookie } })
    ).text();

    expect(opened).toContain(
      `<div role="status" class="alert" data-variant="info" data-layout="text-only">${notice}</div>`,
    );
    expect(ownPage).not.toContain(notice);
  });

  test("replaces a cookie whose party is no longer on the waitlist", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));
    const anasToken = anasCookie.replace("party=", "");

    const opened = await app.request(`/party/${anasToken}`, {
      headers: { Cookie: "party=gone" },
    });

    expect(partyCookie(opened)).toBe(anasCookie);
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
    const anasToken = anasCookie.replace("party=", "");

    const card = await (
      await app.request("/", { headers: { Cookie: anasCookie } })
    ).text();
    const joinForm = await (await app.request("/")).text();

    const field = /<input id="party-link"[^>]*>/.exec(card)?.[0] ?? "";
    expect(field).toContain('readOnly=""');
    expect(field).toContain(`value="http://localhost/party/${anasToken}"`);
    expect(field).toContain('aria-describedby="party-link-hint"');
    expect(card).toContain(
      '<label for="party-link">Your party&#x27;s link</label>',
    );
    expect(card).toContain(
      '<p id="party-link-hint" class="secondary">Share it with the rest of your party, or open it on another device. Anyone with this link can see your place on the waitlist.</p>',
    );
    expect(card).not.toContain("sms:");
    expect(card).not.toContain("mailto:");
    expect(joinForm).not.toContain("/party/");
  });

  test("offers a Copy button only to browsers that run the script", async () => {
    const app = await routes();
    const anasCookie = partyCookie(await postJoin(app, ana));

    const card = await (
      await app.request("/", { headers: { Cookie: anasCookie } })
    ).text();
    const joinForm = await (await app.request("/")).text();

    expect(card).toMatch(
      /<button type="button" id="copy-link" class="custom" aria-label="Copy link" hidden=""><svg aria-hidden="true"/,
    );
    expect(card).toContain(
      '<span role="status" id="copy-status" class="visually-hidden"></span>',
    );
    expect(card).toMatch(/<script>[\s\S]*copy-link[\s\S]*<\/script>/);
    expect(joinForm).not.toContain("<script");
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
      withSavesAlwaysConflicting(await emptyStore()),
      env,
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
    const app = waitlistRoutes(withLoadFailing(await emptyStore()), env);

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

  test("shows the friendly page when the routes are mounted in another app", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono().route(
      "/",
      waitlistRoutes(withLoadFailing(await emptyStore()), env),
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
    const app = waitlistRoutes(store, env);

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
    const anasToken = anasCookie.replace("party=", "");
    const bensCookie = partyCookie(
      await postJoin(app, { ...ana, name: "Ben", email: "ben@example.com" }),
    );
    const failing = waitlistRoutes(withLoadFailing(await emptyStore()), env);

    const pages = {
      "join form": await app.request("/"),
      "party card": await app.request("/", { headers: { Cookie: bensCookie } }),
      "another party's link": await app.request(`/party/${anasToken}`, {
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
  test("carries TableKit's stylesheet in every page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tablekitCss = readFileSync(
      createRequire(import.meta.url).resolve(
        "@tablecheck/tablekit-css/tablekit.classless.min.css",
      ),
      "utf8",
    );
    const app = await routes();
    const joined = await postJoin(app, ana);
    const failing = waitlistRoutes(withLoadFailing(await emptyStore()), env);

    const pages = {
      "join form": await app.request("/"),
      "refused join": await postJoin(app, { ...ana, email: "nope" }),
      "party card": await app.request("/", {
        headers: { Cookie: partyCookie(joined) },
      }),
      "error page": await failing.request("/"),
    };

    for (const [page, response] of Object.entries(pages)) {
      // includes() rather than toContain(): a failure would print all 115 KB.
      const html = await response.text();
      expect(html.includes(`<style>${tablekitCss}</style>`), page).toBe(true);
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
    const app = waitlistRoutes(store, env);
    await postJoin(app, ana);
    const busy = waitlistRoutes(withSavesAlwaysConflicting(store), env);

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
