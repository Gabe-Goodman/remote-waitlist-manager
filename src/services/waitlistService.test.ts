// The use cases. The retry loop runs with a plain stub; joining, checking
// in and leaving run against the real MongoDB from Compose, one fresh
// collection per test.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { freshCollection } from "../storage/testDb.js";
import {
  waitlistStore,
  type WaitlistDocument,
  type WaitlistStore,
} from "../storage/waitlistStore.js";
import { retryOnConflict, waitlistService } from "./waitlistService.js";

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

    const outcome = await waitlistService(store, env).join({
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

    const outcome = await waitlistService(store, env).join({
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
      forms.map((form) => waitlistService(store, env).join(form)),
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
      waitlistService(store, env).join(form),
      waitlistService(store, env).join(form),
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
      waitlistService(store, env).join(form),
      waitlistService(store, env).join(form),
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
    const first = await waitlistService(store, env).join(form);
    const { version } = await store.load();

    const second = await waitlistService(store, env).join(form);

    if (!first.ok || !second.ok)
      throw new Error(`join refused: ${JSON.stringify([first, second])}`);
    expect(second.party.token).toBe(first.party.token);
    expect((await store.load()).version).toBe(version);
  });
});

async function joined(store: WaitlistStore, name: string, size: number) {
  const outcome = await waitlistService(store, env).join({
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

    const outcome = await waitlistService(store, env).checkIn(ana.token);

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

    const outcome = await waitlistService(store, env).checkIn(ben.token);

    expect(outcome).toEqual({ ok: false, reason: "not-ready" });
    expect(await store.load()).toEqual(before);
  });

  test("refuses a second check-in for the same party", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);
    await waitlistService(store, env).checkIn(ana.token);

    const outcome = await waitlistService(store, env).checkIn(ana.token);

    expect(outcome).toEqual({ ok: false, reason: "already-checked-in" });
  });

  test("refuses a token that isn't on the waitlist", async () => {
    const store = await emptyStore();
    await joined(store, "Ana", 2);

    const outcome = await waitlistService(store, env).checkIn("no-such-token");

    expect(outcome).toEqual({ ok: false, reason: "not-found" });
  });

  test("checks in five ready parties checking in at once: all saved, none busy", async () => {
    const store = await emptyStore();
    const parties = [];
    for (const name of ["Ana", "Ben", "Cy", "Dee", "Eve"]) {
      parties.push(await joined(store, name, 2));
    }

    const outcomes = await Promise.all(
      parties.map((party) => waitlistService(store, env).checkIn(party.token)),
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
      waitlistService(store, env).checkIn(ana.token),
      waitlistService(store, env).checkIn(ana.token),
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

describe("leaving", () => {
  test("takes a party off the waitlist and saves it", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);

    const outcome = await waitlistService(store, env).leave(ana.token);

    expect(outcome).toEqual({ ok: true, party: { ...ana, leftAt: env.now() } });
    const { waitlist } = await store.load();
    expect(waitlist.parties[0]?.leftAt).toEqual(env.now());
  });

  test("refuses a party that has checked in, without saving anything", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);
    await waitlistService(store, env).checkIn(ana.token);
    const before = await store.load();

    const outcome = await waitlistService(store, env).leave(ana.token);

    expect(outcome).toEqual({ ok: false, reason: "seated" });
    expect(await store.load()).toEqual(before);
  });

  test("refuses a party that has already left", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);
    await waitlistService(store, env).leave(ana.token);

    const outcome = await waitlistService(store, env).leave(ana.token);

    expect(outcome).toEqual({ ok: false, reason: "already-left" });
  });

  test("refuses a token that isn't on the waitlist", async () => {
    const store = await emptyStore();
    await joined(store, "Ana", 2);

    const outcome = await waitlistService(store, env).leave("no-such-token");

    expect(outcome).toEqual({ ok: false, reason: "not-found" });
  });

  test("lets a party either check in or leave, not both, when both happen at once", async () => {
    const store = await emptyStore();
    const ana = await joined(store, "Ana", 2);

    const [checkedIn, left] = await Promise.all([
      waitlistService(store, env).checkIn(ana.token),
      waitlistService(store, env).leave(ana.token),
    ]);

    const { waitlist } = await store.load();
    const stored = waitlist.parties[0];
    if (checkedIn.ok) {
      expect(left).toEqual({ ok: false, reason: "seated" });
      expect(stored?.leftAt).toBeUndefined();
    } else {
      // A party that has left is no longer ready, so its check-in is
      // refused as not ready.
      expect(checkedIn).toEqual({ ok: false, reason: "not-ready" });
      expect(left.ok).toBe(true);
      expect(stored?.checkedInAt).toBeUndefined();
    }
  });
});

describe("forgetting finished parties", () => {
  const twoDaysAgo = new Date(env.now().getTime() - 2 * 24 * 60 * 60 * 1000);
  const longGone = {
    token: "token-long-gone",
    name: "Zoe",
    email: "zoe@example.com",
    size: 2,
    joinedAt: twoDaysAgo,
    leftAt: twoDaysAgo,
  };

  /** A store holding a party that left two days ago, and Ana, waiting. */
  async function storeWithHistory() {
    const store = await emptyStore();
    await store.saveIfVersion({ parties: [longGone] }, 0);
    const ana = await joined(store, "Ana", 2);
    return { store, ana };
  }

  test("forgets a party that left days ago when the next party joins", async () => {
    const { store, ana } = await storeWithHistory();

    const { waitlist } = await store.load();
    expect(waitlist.parties.map((p) => p.token)).toEqual([ana.token]);
  });

  test("forgets it on a check-in and on a leave too", async () => {
    for (const write of ["checkIn", "leave"] as const) {
      const store = await emptyStore();
      const ana = await joined(store, "Ana", 2);
      const { version } = await store.load();
      await store.saveIfVersion({ parties: [longGone, ana] }, version);

      const outcome = await waitlistService(store, env)[write](ana.token);

      expect(outcome.ok).toBe(true);
      const { waitlist } = await store.load();
      expect(waitlist.parties.map((p) => p.token)).toEqual([ana.token]);
    }
  });

  test("shows a forgotten party's link as not found", async () => {
    const { store } = await storeWithHistory();

    expect(await waitlistService(store, env).find(longGone.token)).toBe(
      undefined,
    );
  });
});
