// The waitlist's rules as unit tests: plain values in and out, no database.
import { describe, expect, test } from "vitest";
import {
  checkIn,
  checkInWindowMs,
  isDone,
  isInService,
  joinWaitlist,
  leaveWaitlist,
  partiesWaiting,
  partyPlace,
  partyState,
  readyParties,
  seatCount,
  seatsAvailable,
  serviceEndsAt,
  validateJoin,
  type Party,
} from "./waitlist.js";

const valid = { name: "Ana", email: "ana@example.com", size: "2", joinKey: "" };

/** An email of exactly `length` characters, shaped like x@y.z. */
function emailOfLength(length: number): string {
  const local = "a".repeat(64);
  return `${local}@${"b".repeat(length - local.length - 5)}.com`;
}

describe("validating the join form", () => {
  test("reports every invalid field at once", () => {
    const result = validateJoin({ name: "", email: "nope", size: "0" });

    expect(result).toEqual({
      ok: false,
      errors: { name: "required", email: "invalid", size: "invalid" },
    });
  });

  test("reports a name of only spaces as required", () => {
    const result = validateJoin({ ...valid, name: " " });

    expect(result).toEqual({ ok: false, errors: { name: "required" } });
  });

  test("reports a missing email as required, not invalid", () => {
    const result = validateJoin({ ...valid, email: "  " });

    expect(result).toEqual({ ok: false, errors: { email: "required" } });
  });

  test("accepts a name of 50 characters and refuses 51", () => {
    expect(validateJoin({ ...valid, name: "x".repeat(50) }).ok).toBe(true);
    expect(validateJoin({ ...valid, name: "x".repeat(51) })).toEqual({
      ok: false,
      errors: { name: "too-long" },
    });
  });

  test("accepts an email of 254 characters and refuses 255", () => {
    expect(validateJoin({ ...valid, email: emailOfLength(254) }).ok).toBe(true);
    expect(validateJoin({ ...valid, email: emailOfLength(255) })).toEqual({
      ok: false,
      errors: { email: "too-long" },
    });
  });

  test("refuses an email without the x@y.z shape", () => {
    for (const email of ["ana", "ana@example", "@example.com", "a na@x.com"]) {
      expect(validateJoin({ ...valid, email })).toEqual({
        ok: false,
        errors: { email: "invalid" },
      });
    }
  });

  test("accepts party sizes 1 to 10 and refuses anything else", () => {
    expect(validateJoin({ ...valid, size: "1" }).ok).toBe(true);
    expect(validateJoin({ ...valid, size: "10" }).ok).toBe(true);
    for (const size of ["0", "11", "2.5", "two", "", "1e1"]) {
      expect(validateJoin({ ...valid, size })).toEqual({
        ok: false,
        errors: { size: "invalid" },
      });
    }
  });

  test("trims the name and stores the email trimmed and lowercased", () => {
    const result = validateJoin({
      name: "  Ana  ",
      email: "  Ana@Example.COM ",
      size: " 3 ",
    });

    expect(result).toEqual({
      ok: true,
      details: { name: "Ana", email: "ana@example.com", size: 3 },
    });
  });
});

const context = { now: new Date("2026-11-07T18:00:00Z"), token: "token-ana" };

function partyNamed(name: string, facts: Partial<Party> = {}): Party {
  return {
    token: `token-${name}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    size: 2,
    joinedAt: new Date("2026-11-07T18:00:00Z"),
    ...facts,
  };
}

describe("joining", () => {
  test("adds a party at the back of the queue", () => {
    const waitlist = { parties: [partyNamed("Ben")] };

    const result = joinWaitlist(waitlist, valid, context);

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.waitlist.parties.map((p) => p.name)).toEqual(["Ben", "Ana"]);
  });

  test("gives the party the token and join time it is handed", () => {
    const result = joinWaitlist({ parties: [] }, valid, context);

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.party).toEqual({
      token: "token-ana",
      name: "Ana",
      email: "ana@example.com",
      size: 2,
      joinedAt: context.now,
    });
  });

  test("refuses an invalid form", () => {
    const result = joinWaitlist(
      { parties: [] },
      { ...valid, size: "0" },
      context,
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: { size: "invalid" },
    });
  });

  test("never changes the waitlist it is given", () => {
    const waitlist = { parties: [partyNamed("Ben")] };

    joinWaitlist(waitlist, valid, context);
    joinWaitlist(waitlist, { ...valid, size: "0" }, context);
    joinWaitlist(waitlist, { ...valid, email: "ben@example.com" }, context);

    expect(waitlist.parties.map((p) => p.name)).toEqual(["Ben"]);
  });
});

describe("never on the list twice", () => {
  test("refuses an email that is already on the waitlist", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    const result = joinWaitlist(waitlist, valid, context);

    expect(result).toEqual({ ok: false, reason: "duplicate" });
  });

  test("treats the same email in different case or with spaces as a duplicate", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    const result = joinWaitlist(
      waitlist,
      { ...valid, email: "  ANA@Example.com " },
      context,
    );

    expect(result).toEqual({ ok: false, reason: "duplicate" });
  });

  test("lets the email of a party that has finished join again", () => {
    const finished = partyNamed("Ana", {
      size: 2,
      checkedInAt: new Date("2026-11-07T17:55:00Z"),
    });

    const result = joinWaitlist({ parties: [finished] }, valid, context);

    expect(result.ok).toBe(true);
  });

  test("still refuses the email of a party that is in service", () => {
    const seated = partyNamed("Ana", { size: 2, checkedInAt: context.now });

    const result = joinWaitlist({ parties: [seated] }, valid, context);

    expect(result).toEqual({ ok: false, reason: "duplicate" });
  });

  test("reports an invalid form as invalid, even when the email is taken", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    const result = joinWaitlist(waitlist, { ...valid, size: "0" }, context);

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: { size: "invalid" },
    });
  });
});

describe("the same form sent twice", () => {
  test("returns the party a join key already made, without adding another", () => {
    const ana = partyNamed("Ana", { joinKey: "key-1" });
    const waitlist = { parties: [ana] };

    const result = joinWaitlist(
      waitlist,
      { ...valid, joinKey: "key-1" },
      context,
    );

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.party).toBe(ana);
    expect(result.created).toBe(false);
    expect(result.waitlist.parties).toEqual([ana]);
  });

  test("checks the join key before validating the form", () => {
    const ana = partyNamed("Ana", { joinKey: "key-1" });

    const result = joinWaitlist(
      { parties: [ana] },
      { ...valid, name: "", joinKey: "key-1" },
      context,
    );

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.party).toBe(ana);
  });

  test("ignores the join key of a party that has finished", () => {
    const finished = partyNamed("Ana", {
      size: 2,
      checkedInAt: new Date("2026-11-07T17:55:00Z"),
      joinKey: "key-1",
    });

    const result = joinWaitlist(
      { parties: [finished] },
      { ...valid, joinKey: "key-1" },
      context,
    );

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.created).toBe(true);
    expect(result.party.token).toBe("token-ana");
    expect(result.waitlist.parties).toHaveLength(2);
  });

  test("stores the join key on a new party", () => {
    const result = joinWaitlist(
      { parties: [] },
      { ...valid, joinKey: "key-2" },
      context,
    );

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.party.joinKey).toBe("key-2");
  });

  test("joins as usual without a join key", () => {
    const result = joinWaitlist({ parties: [] }, valid, context);

    if (!result.ok) throw new Error(`join refused: ${JSON.stringify(result)}`);
    expect(result.created).toBe(true);
    expect(result.party).not.toHaveProperty("joinKey");
  });
});

describe("your place in the queue", () => {
  test("counts the parties ahead of you", () => {
    const waitlist = {
      parties: [partyNamed("Ben"), partyNamed("Cy"), partyNamed("Ana")],
    };

    const place = partyPlace(waitlist, "token-Ana", context.now);

    expect(place?.party.name).toBe("Ana");
    expect(place?.ahead).toBe(2);
  });

  test("gives a newcomer every waiting party ahead of them", () => {
    const waitlist = { parties: [partyNamed("Ben"), partyNamed("Cy")] };

    expect(partiesWaiting(waitlist, context.now)).toBe(2);
  });

  test("doesn't know a token that isn't on the waitlist", () => {
    const waitlist = { parties: [partyNamed("Ben")] };

    expect(partyPlace(waitlist, "token-nobody", context.now)).toBeUndefined();
  });

  test("counts only waiting and ready parties ahead of you", () => {
    const checkedInAt = new Date("2026-11-07T18:00:00Z");
    const waitlist = {
      parties: [
        partyNamed("Ben", { checkedInAt }),
        partyNamed("Cy", { checkedInAt: new Date("2026-11-07T17:00:00Z") }),
        partyNamed("Dee"),
        partyNamed("Eve"),
        partyNamed("Ana"),
      ],
    };

    expect(partyPlace(waitlist, "token-Ana", context.now)?.ahead).toBe(2);
    expect(partiesWaiting(waitlist, context.now)).toBe(3);
  });
});

describe("being served", () => {
  const checkedInAt = new Date("2026-11-07T18:00:00Z");
  const secondsAfterCheckIn = (seconds: number) =>
    new Date(checkedInAt.getTime() + seconds * 1000);
  const partyOfFour = partyNamed("Ana", { size: 4, checkedInAt });

  test("serves a party for 3 seconds per person", () => {
    expect(serviceEndsAt(partyOfFour)).toEqual(secondsAfterCheckIn(12));
  });

  test("counts a checked-in party as in service until its time is up", () => {
    for (const now of [checkedInAt, secondsAfterCheckIn(11.999)]) {
      expect(isInService(partyOfFour, now)).toBe(true);
      expect(isDone(partyOfFour, now)).toBe(false);
    }
  });

  test("counts it as done from the moment its time is up", () => {
    for (const now of [secondsAfterCheckIn(12), secondsAfterCheckIn(60)]) {
      expect(isDone(partyOfFour, now)).toBe(true);
      expect(isInService(partyOfFour, now)).toBe(false);
    }
  });

  test("counts a party that hasn't checked in as neither in service nor done", () => {
    const waiting = partyNamed("Ben", { size: 4 });

    expect(serviceEndsAt(waiting)).toBeUndefined();
    expect(isInService(waiting, checkedInAt)).toBe(false);
    expect(isDone(waiting, secondsAfterCheckIn(60))).toBe(false);
  });
});

describe("ready in strict order", () => {
  const now = new Date("2026-11-07T18:00:00Z");
  const secondsFromNow = (seconds: number) =>
    new Date(now.getTime() + seconds * 1000);
  const readyNames = (parties: Party[], at: Date) =>
    readyParties({ parties }, at).map((party) => party.name);

  test("makes the first party ready when it fits", () => {
    const parties = [partyNamed("Ana", { size: 4 })];

    expect(readyNames(parties, now)).toEqual(["Ana"]);
    expect(seatsAvailable({ parties }, now)).toBe(6);
  });

  test("makes every party at the front ready while they fit", () => {
    const parties = [
      partyNamed("Ana", { size: 4 }),
      partyNamed("Ben", { size: 3 }),
      partyNamed("Cy", { size: 2 }),
      partyNamed("Dee", { size: 2 }),
    ];

    expect(readyNames(parties, now)).toEqual(["Ana", "Ben", "Cy"]);
    expect(seatsAvailable({ parties }, now)).toBe(1);
  });

  test("keeps a party waiting when ready parties ahead hold the seats", () => {
    const parties = [
      partyNamed("Ana", { size: 6 }),
      partyNamed("Ben", { size: 5 }),
    ];

    expect(readyNames(parties, now)).toEqual(["Ana"]);
    expect(seatsAvailable({ parties }, now)).toBe(4);
  });

  test("keeps everyone behind a party that doesn't fit waiting, even a party that would fit", () => {
    const parties = [
      partyNamed("Ana", { size: 8 }),
      partyNamed("Ben", { size: 3 }),
      partyNamed("Cy", { size: 1 }),
    ];

    expect(readyNames(parties, now)).toEqual(["Ana"]);
    expect(seatsAvailable({ parties }, now)).toBe(2);
  });

  test("counts the seats of parties in service until each service ends, then frees them", () => {
    const parties = [
      partyNamed("Ana", { size: 6, checkedInAt: now }),
      partyNamed("Ben", { size: 5 }),
    ];
    const serviceEnds = secondsFromNow(18);

    expect(readyNames(parties, secondsFromNow(17.999))).toEqual([]);
    expect(seatsAvailable({ parties }, secondsFromNow(17.999))).toBe(4);
    expect(readyNames(parties, serviceEnds)).toEqual(["Ben"]);
    expect(seatsAvailable({ parties }, serviceEnds)).toBe(5);
  });

  test("never seats more people than the restaurant has", () => {
    const inService = (name: string, size: number, secondsAgo: number) =>
      partyNamed(name, { size, checkedInAt: secondsFromNow(-secondsAgo) });
    const waiting = (name: string, size: number) => partyNamed(name, { size });
    const queues: Party[][] = [
      [waiting("A", 10), waiting("B", 1)],
      [waiting("A", 1), waiting("B", 10), waiting("C", 1)],
      [inService("A", 7, 0), waiting("B", 3), waiting("C", 1)],
      [inService("A", 4, 5), inService("B", 5, 1), waiting("C", 2)],
      [inService("A", 10, 10), waiting("B", 10), waiting("C", 1)],
      [waiting("A", 3), waiting("B", 3), waiting("C", 3), waiting("D", 3)],
      [inService("A", 2, 3), waiting("B", 9), waiting("C", 8)],
      [waiting("A", 5), waiting("B", 5), waiting("C", 1), waiting("D", 9)],
      [
        inService("A", 1, 1),
        inService("B", 1, 2),
        waiting("C", 8),
        waiting("D", 1),
      ],
    ];
    const moments = [0, 2.5, 6, 12, 15, 30].map(secondsFromNow);

    for (const parties of queues) {
      for (const at of moments) {
        const seated = parties
          .filter((party) => isInService(party, at))
          .reduce((sum, party) => sum + party.size, 0);
        const held = readyParties({ parties }, at).reduce(
          (sum, party) => sum + party.size,
          0,
        );

        expect(seated + held).toBeLessThanOrEqual(seatCount);
        expect(seatsAvailable({ parties }, at)).toBe(seatCount - seated - held);
      }
    }
  });

  test("has every seat available when no one is seated or ready", () => {
    expect(seatsAvailable({ parties: [] }, now)).toBe(10);
  });
});

describe("where a party stands", () => {
  const now = new Date("2026-11-07T18:00:00Z");
  const secondsFromNow = (seconds: number) =>
    new Date(now.getTime() + seconds * 1000);

  test("says a party is waiting, with how many parties are ahead of it", () => {
    const waitlist = {
      parties: [
        partyNamed("Ana", { size: 8 }),
        partyNamed("Ben", { size: 3 }),
        partyNamed("Cy", { size: 1 }),
      ],
    };

    expect(partyState(waitlist, "token-Ben", now)).toEqual({
      kind: "waiting",
      ahead: 1,
    });
    expect(partyState(waitlist, "token-Cy", now)).toEqual({
      kind: "waiting",
      ahead: 2,
    });
  });

  test("says a party is ready when its table is ready", () => {
    const waitlist = { parties: [partyNamed("Ana", { size: 8 })] };

    expect(partyState(waitlist, "token-Ana", now)).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(60),
    });
  });

  test("says a checked-in party is in service until its time is up, then done", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 4, checkedInAt: now })],
    };

    expect(partyState(waitlist, "token-Ana", secondsFromNow(11.999))).toEqual({
      kind: "in-service",
    });
    expect(partyState(waitlist, "token-Ana", secondsFromNow(12))).toEqual({
      kind: "done",
    });
  });

  test("doesn't know a token that isn't on the waitlist", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    expect(partyState(waitlist, "token-nobody", now)).toBeUndefined();
  });
});

describe("checking in", () => {
  const now = new Date("2026-11-07T18:00:00Z");
  const secondsFromNow = (seconds: number) =>
    new Date(now.getTime() + seconds * 1000);

  test("checks in a party whose table is ready", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 4 }), partyNamed("Ben", { size: 3 })],
    };

    const result = checkIn(waitlist, "token-Ben", now);

    if (!result.ok) throw new Error(`check-in refused: ${result.reason}`);
    expect(result.party.name).toBe("Ben");
    expect(result.party.checkedInAt).toEqual(now);
    expect(result.waitlist.parties.map((p) => p.name)).toEqual(["Ana", "Ben"]);
    expect(result.waitlist.parties[1]?.checkedInAt).toEqual(now);
  });

  test("refuses a party that isn't ready yet", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 8 }), partyNamed("Ben", { size: 3 })],
    };

    expect(checkIn(waitlist, "token-Ben", now)).toEqual({
      ok: false,
      reason: "not-ready",
    });
  });

  test("refuses a party that has already checked in", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 4, checkedInAt: now })],
    };

    for (const at of [secondsFromNow(1), secondsFromNow(12)]) {
      expect(checkIn(waitlist, "token-Ana", at)).toEqual({
        ok: false,
        reason: "already-checked-in",
      });
    }
  });

  test("refuses a token that isn't on the waitlist", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    expect(checkIn(waitlist, "token-nobody", now)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  test("never changes the waitlist it is given", () => {
    const waitlist = { parties: [partyNamed("Ana"), partyNamed("Ben")] };

    checkIn(waitlist, "token-Ana", now);

    expect(waitlist.parties.map((p) => p.checkedInAt)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("holds the seats it checked in with until its service ends", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 6 }), partyNamed("Ben", { size: 5 })],
    };

    const result = checkIn(waitlist, "token-Ana", now);

    if (!result.ok) throw new Error(`check-in refused: ${result.reason}`);
    expect(
      partyState(result.waitlist, "token-Ben", secondsFromNow(17.999)),
    ).toEqual({ kind: "waiting", ahead: 0 });
    expect(
      partyState(result.waitlist, "token-Ben", secondsFromNow(18)),
    ).toEqual({ kind: "ready", checkInBy: secondsFromNow(78) });
  });
});

describe("leaving", () => {
  const now = new Date("2026-11-07T18:00:00Z");
  const secondsFromNow = (seconds: number) =>
    new Date(now.getTime() + seconds * 1000);

  test("lets a waiting party leave", () => {
    const waitlist = {
      parties: [
        partyNamed("Ana", { size: 8 }),
        partyNamed("Ben", { size: 3 }),
        partyNamed("Cy"),
      ],
    };

    const result = leaveWaitlist(waitlist, "token-Ben", now);

    if (!result.ok) throw new Error(`leave refused: ${result.reason}`);
    expect(result.party.leftAt).toEqual(now);
    expect(result.waitlist.parties.map((p) => p.name)).toEqual([
      "Ana",
      "Ben",
      "Cy",
    ]);
    expect(partyState(result.waitlist, "token-Ben", now)).toEqual({
      kind: "left",
    });
  });

  test("frees a ready party's seats when it leaves", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 8 }), partyNamed("Ben", { size: 3 })],
    };

    const result = leaveWaitlist(waitlist, "token-Ana", now);

    if (!result.ok) throw new Error(`leave refused: ${result.reason}`);
    expect(partyState(result.waitlist, "token-Ben", now)).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(60),
    });
  });

  test("doesn't count a party that left as ahead of anyone", () => {
    const waitlist = {
      parties: [
        partyNamed("Ben", { leftAt: now }),
        partyNamed("Cy"),
        partyNamed("Ana"),
      ],
    };

    expect(partyPlace(waitlist, "token-Ana", now)?.ahead).toBe(1);
    expect(partiesWaiting(waitlist, now)).toBe(2);
  });

  test("lets the email of a party that left join again, at the back of the queue", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { leftAt: now }), partyNamed("Ben")],
    };

    const result = joinWaitlist(
      waitlist,
      { ...valid, email: "ana@example.com" },
      { now: secondsFromNow(1), token: "token-ana-again" },
    );

    if (!result.ok) throw new Error(`join refused: ${result.reason}`);
    expect(result.waitlist.parties.map((p) => p.token)).toEqual([
      "token-Ana",
      "token-Ben",
      "token-ana-again",
    ]);
  });

  test("refuses to let a party that has checked in leave", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 4, checkedInAt: now })],
    };

    for (const at of [secondsFromNow(1), secondsFromNow(12)]) {
      expect(leaveWaitlist(waitlist, "token-Ana", at)).toEqual({
        ok: false,
        reason: "seated",
      });
    }
  });

  test("refuses a party that has already left", () => {
    const waitlist = { parties: [partyNamed("Ana", { leftAt: now })] };

    expect(leaveWaitlist(waitlist, "token-Ana", secondsFromNow(1))).toEqual({
      ok: false,
      reason: "already-left",
    });
  });

  test("refuses a token that isn't on the waitlist", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    expect(leaveWaitlist(waitlist, "token-nobody", now)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  test("never changes the waitlist it is given", () => {
    const waitlist = { parties: [partyNamed("Ana"), partyNamed("Ben")] };

    leaveWaitlist(waitlist, "token-Ana", now);

    expect(waitlist.parties.map((p) => p.leftAt)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("checking in on time", () => {
  const now = new Date("2026-11-07T18:00:00Z");
  const secondsFromNow = (seconds: number) =>
    new Date(now.getTime() + seconds * 1000);
  const stateOf = (parties: Party[], name: string, at: Date) =>
    partyState({ parties }, `token-${name}`, at);

  test("gives a party one minute to check in", () => {
    expect(checkInWindowMs).toBe(60_000);
  });

  test("gives every party exactly one minute from the moment its table is ready", () => {
    const parties = [partyNamed("Ana", { joinedAt: secondsFromNow(20) })];

    expect(stateOf(parties, "Ana", secondsFromNow(20))).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(80),
    });
    expect(stateOf(parties, "Ana", secondsFromNow(79.999))?.kind).toBe("ready");
    expect(stateOf(parties, "Ana", secondsFromNow(80))?.kind).toBe("expired");
  });

  test("starts a party's minute when it joins, if its table is free", () => {
    const parties = [partyNamed("Ana", { joinedAt: secondsFromNow(30) })];

    expect(stateOf(parties, "Ana", secondsFromNow(30))).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(90),
    });
  });

  test("starts a party's minute when its table becomes ready, not when it joined", () => {
    const parties = [
      partyNamed("Ana", { size: 6, checkedInAt: now }),
      partyNamed("Ben", { size: 5 }),
    ];

    expect(stateOf(parties, "Ben", secondsFromNow(18))).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(78),
    });
  });

  test("expires a ready party that hasn't checked in by its deadline", () => {
    const parties = [partyNamed("Ana", { size: 8 })];

    expect(stateOf(parties, "Ana", secondsFromNow(59.999))?.kind).toBe("ready");
    expect(stateOf(parties, "Ana", secondsFromNow(60))).toEqual({
      kind: "expired",
    });
  });

  test("gives an expired party's seats to the next party in line, whose minute starts then", () => {
    const parties = [
      partyNamed("Ana", { size: 8 }),
      partyNamed("Ben", { size: 3 }),
    ];

    expect(stateOf(parties, "Ben", secondsFromNow(59.999))?.kind).toBe(
      "waiting",
    );
    expect(stateOf(parties, "Ben", secondsFromNow(60))).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(120),
    });
    expect(seatsAvailable({ parties }, secondsFromNow(60))).toBe(7);
  });

  test("expires parties one after another while nobody checks in", () => {
    const parties = [
      partyNamed("Ana", { size: 10 }),
      partyNamed("Ben", { size: 10 }),
      partyNamed("Cy", { size: 10 }),
    ];
    const at = secondsFromNow(130);

    expect(stateOf(parties, "Ana", at)).toEqual({ kind: "expired" });
    expect(stateOf(parties, "Ben", at)).toEqual({ kind: "expired" });
    expect(stateOf(parties, "Cy", at)).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(180),
    });
  });

  test("keeps a ready party's deadline when a party ahead of it leaves", () => {
    const parties = [
      partyNamed("Ana", { size: 4, leftAt: secondsFromNow(30) }),
      partyNamed("Ben", { size: 4 }),
    ];

    expect(stateOf(parties, "Ben", secondsFromNow(30))).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(60),
    });
  });

  test("starts the minute of a party made ready by a leave when that party left", () => {
    const parties = [
      partyNamed("Ana", { size: 8, leftAt: secondsFromNow(30) }),
      partyNamed("Ben", { size: 3 }),
    ];

    expect(stateOf(parties, "Ben", secondsFromNow(30))).toEqual({
      kind: "ready",
      checkInBy: secondsFromNow(90),
    });
  });

  test("never expires a party that checked in in time", () => {
    const parties = [
      partyNamed("Ana", { size: 1, checkedInAt: secondsFromNow(59) }),
    ];

    expect(stateOf(parties, "Ana", secondsFromNow(61))).toEqual({
      kind: "in-service",
    });
    expect(stateOf(parties, "Ana", secondsFromNow(120))).toEqual({
      kind: "done",
    });
  });

  test("lets a party check in just before its deadline", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    expect(checkIn(waitlist, "token-Ana", secondsFromNow(59.999)).ok).toBe(
      true,
    );
  });

  test("refuses a check-in from the deadline on", () => {
    const waitlist = { parties: [partyNamed("Ana")] };

    expect(checkIn(waitlist, "token-Ana", secondsFromNow(60))).toEqual({
      ok: false,
      reason: "not-ready",
    });
  });

  test("doesn't count an expired party as waiting or ahead of anyone", () => {
    const parties = [
      partyNamed("Ana", { size: 8 }),
      partyNamed("Ben", { size: 3 }),
    ];
    const at = secondsFromNow(60);

    expect(partyPlace({ parties }, "token-Ben", at)?.ahead).toBe(0);
    expect(partiesWaiting({ parties }, at)).toBe(1);
  });

  test("lets the email of an expired party join again, at the back of the queue", () => {
    const waitlist = {
      parties: [partyNamed("Ana", { size: 8 }), partyNamed("Ben", { size: 3 })],
    };

    const result = joinWaitlist(
      waitlist,
      { ...valid, email: "ana@example.com" },
      { now: secondsFromNow(60), token: "token-ana-again" },
    );

    if (!result.ok) throw new Error(`join refused: ${result.reason}`);
    expect(result.waitlist.parties.map((p) => p.token)).toEqual([
      "token-Ana",
      "token-Ben",
      "token-ana-again",
    ]);
  });
});

describe("replaying the past with later facts", () => {
  const now = new Date("2026-11-07T18:00:00Z");
  const secondsFromNow = (seconds: number) =>
    new Date(now.getTime() + seconds * 1000);

  test("doesn't let a check-in hold seats before it happened, which would bring an expired party back", () => {
    // Ana (10) is ready at 0 and runs out of time at 60. Ben (1) joins at
    // 70, is ready at once and checks in at 75: his seat is taken from 75,
    // not from the start of the evening.
    const parties = [
      partyNamed("Ana", { size: 10 }),
      partyNamed("Ben", {
        size: 1,
        joinedAt: secondsFromNow(70),
        checkedInAt: secondsFromNow(75),
      }),
    ];

    expect(partyState({ parties }, "token-Ana", secondsFromNow(80))).toEqual({
      kind: "expired",
    });
  });
});
