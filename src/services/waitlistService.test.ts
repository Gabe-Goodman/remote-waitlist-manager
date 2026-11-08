// The use cases. The retry loop runs with a plain stub; joining and
// checking in run against the real MongoDB from Compose, one fresh
// collection per test.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { freshCollection } from "../storage/testDb.js";
import {
  waitlistStore,
  type WaitlistDocument,
  type WaitlistStore,
} from "../storage/waitlistStore.js";
import {
  checkInParty,
  joinWaitlist,
  retryOnConflict,
} from "./waitlistService.js";

describe("retrying a save that conflicted", () => {
  test("succeeds on the next attempt after one conflict", async () => {
    const answers = ["conflict", "saved"] as const;
    let calls = 0;

    const result = await retryOnConflict(
      () => Promise.resolve(answers[calls++]),
      10,
    );

    expect(result).toBe("saved");
    expect(calls).toBe(2);
  });

  test("gives up as busy after the last attempt", async () => {
    let calls = 0;

    const result = await retryOnConflict(() => {
      calls++;
      return Promise.resolve("conflict" as const);
    }, 3);

    expect(result).toBe("busy");
    expect(calls).toBe(3);
  });

  test("never retries an exception", async () => {
    let calls = 0;

    const result = retryOnConflict(() => {
      calls++;
      return Promise.reject(new Error("database down"));
    }, 10);

    await expect(result).rejects.toThrow("database down");
    expect(calls).toBe(1);
  });
});

const env = {
  now: () => new Date("2026-11-07T18:00:00Z"),
  newToken: () => randomUUID(),
};

async function emptyStore() {
  const store = waitlistStore(freshCollection<WaitlistDocument>());
  await store.ensureExists();
  return store;
}

describe("joining the waitlist", () => {
  test("saves a new party so it loads back", async () => {
    const store = await emptyStore();

    const outcome = await joinWaitlist(store, env, {
      name: "Ana",
      email: "ana@example.com",
      size: "2",
      joinKey: "",
    });

    if (!outcome.ok)
      throw new Error(`join refused: ${JSON.stringify(outcome)}`);
    const { waitlist } = await store.load();
    expect(waitlist.parties).toEqual([outcome.party]);
  });

  test("refuses an invalid form without saving anything", async () => {
    const store = await emptyStore();

    const outcome = await joinWaitlist(store, env, {
      name: "",
      email: "ana@example.com",
      size: "2",
      joinKey: "",
    });

    expect(outcome).toEqual({
      ok: false,
      reason: "invalid",
      errors: { name: "required" },
    });
    expect(await store.load()).toEqual({
      waitlist: { parties: [] },
      version: 0,
    });
  });

  test("lets 20 simultaneous joins in: all saved, none busy", async () => {
    const store = await emptyStore();
    const forms = Array.from({ length: 20 }, (_, i) => ({
      name: `Party ${i}`,
      email: `party${i}@example.com`,
      size: "2",
      joinKey: "",
    }));

    const outcomes = await Promise.all(
      forms.map((form) => joinWaitlist(store, env, form)),
    );

    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([]);
    const { waitlist } = await store.load();
    expect(waitlist.parties).toHaveLength(20);
  });

  test("lets only one of two simultaneous joins with the same email in", async () => {
    const store = await emptyStore();
    const form = {
      name: "Ana",
      email: "ana@example.com",
      size: "2",
      joinKey: "",
    };

    const outcomes = await Promise.all([
      joinWaitlist(store, env, form),
      joinWaitlist(store, env, form),
    ]);

    expect(outcomes.map((outcome) => outcome.ok).toSorted()).toEqual([
      false,
      true,
    ]);
    expect(outcomes).toContainEqual({ ok: false, reason: "duplicate" });
    const { waitlist } = await store.load();
    expect(waitlist.parties).toHaveLength(1);
  });

  test("lets two simultaneous submissions of the same form make one party", async () => {
    const store = await emptyStore();
    const form = {
      name: "Ana",
      email: "ana@example.com",
      size: "2",
      joinKey: "key-1",
    };

    const [first, second] = await Promise.all([
      joinWaitlist(store, env, form),
      joinWaitlist(store, env, form),
    ]);

    if (!first?.ok || !second?.ok)
      throw new Error(`join refused: ${JSON.stringify([first, second])}`);
    expect(second.party.token).toBe(first.party.token);
    const { waitlist } = await store.load();
    expect(waitlist.parties).toHaveLength(1);
  });

  test("doesn't save again when the same form is sent after it succeeded", async () => {
    const store = await emptyStore();
    const form = {
      name: "Ana",
      email: "ana@example.com",
      size: "2",
      joinKey: "key-1",
    };
    const first = await joinWaitlist(store, env, form);
    const { version } = await store.load();

    const second = await joinWaitlist(store, env, form);

    if (!first.ok || !second.ok)
      throw new Error(`join refused: ${JSON.stringify([first, second])}`);
    expect(second.party.token).toBe(first.party.token);
    expect((await store.load()).version).toBe(version);
  });
});

async function joined(store: WaitlistStore, name: string, size: number) {
  const outcome = await joinWaitlist(store, env, {
    name,
    email: `${name.toLowerCase()}@example.com`,
    size: String(size),
    joinKey: "",
  });
  if (!outcome.ok) throw new Error(`join refused: ${JSON.stringify(outcome)}`);
  return outcome.party;
}

describe("checking in", () => {
  test("checks in a ready party and saves it", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);

    const outcome = await checkInParty(store, env, ana.token);

    expect(outcome).toEqual({
      ok: true,
      party: { ...ana, checkedInAt: env.now() },
    });
    const { waitlist } = await store.load();
    expect(waitlist.parties[0]?.checkedInAt).toEqual(env.now());
  });

  test("refuses a party that isn't ready, without saving anything", async () => {
    const store = await emptyStore();
    await joined(store, "Ana", 8);
    const ben = await joined(store, "Ben", 3);
    const before = await store.load();

    const outcome = await checkInParty(store, env, ben.token);

    expect(outcome).toEqual({ ok: false, reason: "not-ready" });
    expect(await store.load()).toEqual(before);
  });

  test("refuses a second check-in for the same party", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);
    await checkInParty(store, env, ana.token);

    const outcome = await checkInParty(store, env, ana.token);

    expect(outcome).toEqual({ ok: false, reason: "already-checked-in" });
  });

  test("refuses a token that isn't on the waitlist", async () => {
    const store = await emptyStore();
    await joined(store, "Ana", 2);

    const outcome = await checkInParty(store, env, "no-such-token");

    expect(outcome).toEqual({ ok: false, reason: "not-found" });
  });

  test("checks in five ready parties checking in at once: all saved, none busy", async () => {
    const store = await emptyStore();
    const parties = [];
    for (const name of ["Ana", "Ben", "Cy", "Dee", "Eve"]) {
      parties.push(await joined(store, name, 2));
    }

    const outcomes = await Promise.all(
      parties.map((party) => checkInParty(store, env, party.token)),
    );

    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([]);
    const { waitlist } = await store.load();
    expect(waitlist.parties.map((party) => party.checkedInAt)).toEqual(
      parties.map(() => env.now()),
    );
  });

  test("checks in a party only once when it checks in twice at once", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);

    const outcomes = await Promise.all([
      checkInParty(store, env, ana.token),
      checkInParty(store, env, ana.token),
    ]);

    expect(outcomes.map((outcome) => outcome.ok).toSorted()).toEqual([
      false,
      true,
    ]);
    expect(outcomes).toContainEqual({
      ok: false,
      reason: "already-checked-in",
    });
  });
});
