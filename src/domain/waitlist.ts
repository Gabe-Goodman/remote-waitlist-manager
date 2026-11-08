// The waitlist's rules: pure functions. No database, no clock, no HTTP;
// the current time and new tokens are passed in.

/**
 * The join form as submitted: every field is text until validated.
 * `joinKey` is the token the form was rendered with; "" when missing.
 */
export type JoinForm = {
  name: string;
  email: string;
  size: string;
  joinKey: string;
};

/** A join form that passed validation, cleaned up. */
export type JoinDetails = { name: string; email: string; size: number };

/** One code per invalid field, so each error can be shown next to its field. */
export type FieldErrors = {
  name?: "required" | "too-long";
  email?: "required" | "too-long" | "invalid";
  size?: "invalid";
};

export type JoinValidation =
  { ok: true; details: JoinDetails } | { ok: false; errors: FieldErrors };

// Long enough for any party name, short enough to fit on the card on a phone.
export const maxNameLength = 50;
// The spec: "Restaurant Capacity: Hardcoded to 10 seats".
export const seatCount = 10;
// No party can be larger than the restaurant's seats.
export const maxPartySize = seatCount;
// The longest address SMTP allows.
export const maxEmailLength = 254;

// Deliberately loose: anything shaped like x@y.z. Only a sent email could
// prove an address works, and the app sends none.
const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Digits only: Number() alone would also accept "1e1" or "0x5".
const wholeNumber = /^\d+$/;

export function validateJoin(
  form: Pick<JoinForm, "name" | "email" | "size">,
): JoinValidation {
  const name = form.name.trim();
  // Lowercased so the same address typed differently counts as one party
  // for the duplicate rule. No provider-specific rules (such as Gmail's
  // dots): merging addresses that actually differ could turn a diner away.
  const email = form.email.trim().toLowerCase();
  const sizeText = form.size.trim();
  const size = Number(sizeText);

  const errors: FieldErrors = {};
  if (name === "") errors.name = "required";
  else if (name.length > maxNameLength) errors.name = "too-long";

  if (email === "") errors.email = "required";
  else if (email.length > maxEmailLength) errors.email = "too-long";
  else if (!emailShape.test(email)) errors.email = "invalid";

  if (!wholeNumber.test(sizeText) || size < 1 || size > maxPartySize)
    errors.size = "invalid";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, details: { name, email, size } };
}

/** A party on the waitlist: only facts, never a stored status. */
export type Party = {
  token: string;
  name: string;
  email: string;
  size: number;
  joinedAt: Date;
  /** When the party checked in; absent until then. */
  checkedInAt?: Date;
  /** When the party left the waitlist; absent unless it did. */
  leftAt?: Date;
  /**
   * The key of the form that created the party, so a resubmission of the
   * same form is recognised.
   */
  joinKey?: string;
};

/** The queue, in order: the first party joined first. */
export type Waitlist = { parties: readonly Party[] };

/** What joining needs from outside the rules: the current time and a new token. */
export type JoinContext = { now: Date; token: string };

/**
 * `created: false` means the form had already made this party: the
 * waitlist is returned unchanged and there is nothing to save.
 */
export type JoinWaitlistResult =
  | { ok: true; waitlist: Waitlist; party: Party; created: boolean }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "duplicate" };

/**
 * Validates the form and adds the party at the back of the queue, unless
 * an active party already has its email. A form that already made an
 * active party returns that party instead.
 */
export function joinWaitlist(
  waitlist: Waitlist,
  form: JoinForm,
  context: JoinContext,
): JoinWaitlistResult {
  const active = activeParties(waitlist, context.now);
  // Checked before validating: a matching key means this submission already
  // succeeded, whatever the copy sent now says. Only an active party counts,
  // so a finished party's old form can't bring it back.
  const joined =
    form.joinKey === ""
      ? undefined
      : active.find((party) => party.joinKey === form.joinKey);
  if (joined) return { ok: true, waitlist, party: joined, created: false };

  const validation = validateJoin(form);
  if (!validation.ok) {
    return { ok: false, reason: "invalid", errors: validation.errors };
  }

  // A party must never appear twice while it holds a place. A party that
  // finished, left or ran out of time no longer counts, so the same diner
  // can come back.
  const { email } = validation.details;
  const taken = active.some((party) => party.email === email);
  if (taken) {
    return { ok: false, reason: "duplicate" };
  }

  const party: Party = {
    token: context.token,
    ...validation.details,
    joinedAt: context.now,
    ...(form.joinKey === "" ? {} : { joinKey: form.joinKey }),
  };
  return {
    ok: true,
    waitlist: { parties: [...waitlist.parties, party] },
    party,
    created: true,
  };
}

/**
 * How many parties a newcomer would have ahead of them: those still waiting
 * or ready. A party that has checked in has left the queue for its table,
 * and a party that left or ran out of time has given up its place.
 */
export function partiesWaiting(waitlist: Waitlist, now: Date): number {
  const timeline = replay(waitlist, now);
  return waitlist.parties.filter((party) => inQueue(party, timeline)).length;
}

function inQueue(party: Party, timeline: Timeline): boolean {
  return !party.checkedInAt && !party.leftAt && !ranOut(party, timeline);
}

/** A party and how many parties are ahead of it in the queue. */
export type PartyPlace = { party: Party; ahead: number };

/**
 * Finds the party with this token. The parties ahead of it are counted by
 * the same rule as for a newcomer, over the queue in front of it.
 */
export function partyPlace(
  waitlist: Waitlist,
  token: string,
  now: Date,
): PartyPlace | undefined {
  return placeIn(waitlist, token, replay(waitlist, now));
}

function placeIn(
  waitlist: Waitlist,
  token: string,
  timeline: Timeline,
): PartyPlace | undefined {
  const index = waitlist.parties.findIndex((party) => party.token === token);
  const party = waitlist.parties[index];
  if (!party) return undefined;
  // The timeline covers the whole queue: who ran out of time depends on
  // every party, not only those in front.
  const ahead = waitlist.parties
    .slice(0, index)
    .filter((p) => inQueue(p, timeline)).length;
  return { party, ahead };
}

// The spec: "A party of 4 takes 12 seconds", so 3 seconds per person.
export const serviceMsPerPerson = 3000;

/** When the party's service ends; undefined until it has checked in. */
export function serviceEndsAt(party: Party): Date | undefined {
  if (!party.checkedInAt) return undefined;
  return new Date(
    party.checkedInAt.getTime() + party.size * serviceMsPerPerson,
  );
}

export function isInService(party: Party, now: Date): boolean {
  const endsAt = serviceEndsAt(party);
  return endsAt !== undefined && now < endsAt;
}

export function isDone(party: Party, now: Date): boolean {
  const endsAt = serviceEndsAt(party);
  return endsAt !== undefined && now >= endsAt;
}

/**
 * The parties that still hold a place: not finished, not left and not out
 * of time. Only these block their email and their join key.
 */
export function activeParties(waitlist: Waitlist, now: Date): Party[] {
  const timeline = replay(waitlist, now);
  return waitlist.parties.filter(
    (party) => !isDone(party, now) && !party.leftAt && !ranOut(party, timeline),
  );
}

function totalSize(parties: readonly Party[]): number {
  return parties.reduce((sum, party) => sum + party.size, 0);
}

// The demo's check-in window, the same for every party. A real restaurant
// would give about 10 minutes.
export const checkInWindowMs = 60_000;

/**
 * The parties whose table is ready at `now`, in queue order. Derived from
 * stored facts, never stored: time alone frees seats, so a stale snapshot
 * can only under-count free seats, never overbook.
 */
export function readyParties(waitlist: Waitlist, now: Date): Party[] {
  return replay(waitlist, now).ready;
}

/** The evening up to `now`, rebuilt from the stored facts. */
type Timeline = {
  now: number;
  /** The parties ready at `now`, in queue order. */
  ready: Party[];
  /** When each party that has been ready became ready, by token. */
  readySince: ReadonlyMap<string, number>;
};

/**
 * A ready party has `checkInWindowMs` from the moment its table became
 * ready. That moment is never stored (time passing can cause it, with no
 * request to record it), so it is rebuilt by replaying the facts in time
 * order. Who is ready can only change when a party joins, checks in or
 * leaves, a service ends, or a ready party's time runs out, so the replay
 * jumps from one of those moments to the next and asks the ready rule at
 * each. A ready party stays ready until it checks in, leaves or runs out of
 * time, since nothing else takes its seats; so "ready since" is the first
 * moment it was ready.
 *
 * Example: Ana (8) and then Ben (3) join at 18:00:20. Ana is ready, with
 * until 18:01:20; Ben waits, as 8 + 3 > 10. At 18:01:20 Ana hasn't checked
 * in: her time has run out, her seats are free, and Ben is ready, with until
 * 18:02:20.
 */
function replay(waitlist: Waitlist, now: Date): Timeline {
  const end = now.getTime();
  const factTimes = waitlist.parties
    .flatMap((p) => [p.joinedAt, p.checkedInAt, p.leftAt, serviceEndsAt(p)])
    .filter((time) => time !== undefined)
    .map((time) => time.getTime())
    .filter((time) => time <= end);
  const readySince = new Map<string, number>();
  let ready: Party[] = [];
  // Infinity when there are no facts yet: nothing to replay.
  let at = Math.min(...factTimes);
  while (at <= end) {
    ready = readyAt(waitlist.parties, at, readySince);
    for (const party of ready) {
      if (!readySince.has(party.token)) readySince.set(party.token, at);
    }
    const deadlines = ready.map((party) => deadline(party, readySince));
    at = Math.min(...[...factTimes, ...deadlines].filter((t) => t > at));
  }
  return { now: end, ready, readySince };
}

// The same window for every party, from the moment its table is ready.
// Infinity for a party that has never been ready: it can't run out of time.
function deadline(party: Party, readySince: ReadonlyMap<string, number>) {
  return (readySince.get(party.token) ?? Infinity) + checkInWindowMs;
}

/** Was ready, and neither checked in nor left before its time ran out. */
function ranOut(party: Party, timeline: Timeline): boolean {
  return (
    !party.checkedInAt &&
    !party.leftAt &&
    deadline(party, timeline.readySince) <= timeline.now
  );
}

/** The ready parties at one moment of the replay. */
function readyAt(
  parties: readonly Party[],
  at: number,
  readySince: ReadonlyMap<string, number>,
): Party[] {
  const when = new Date(at);
  // Seated at that moment: checked in by then and not yet finished. A
  // check-in that came later holds no seats earlier in the replay, or it
  // would rewrite the past and could bring an expired party back.
  const seated = parties.filter(
    (party) =>
      party.checkedInAt !== undefined &&
      party.checkedInAt.getTime() <= at &&
      isInService(party, when),
  );
  let free = seatCount - totalSize(seated);
  const ready: Party[] = [];
  for (const party of parties) {
    if (party.joinedAt.getTime() > at) continue;
    // A party that checked in, left or ran out of time holds no queue seats:
    // they go to the next party that fits, from this same moment.
    const gone = party.checkedInAt ?? party.leftAt;
    if (gone && gone.getTime() <= at) continue;
    if (deadline(party, readySince) <= at) continue;
    // First come, first served: at the first party that doesn't fit, everyone
    // behind it waits too, even a smaller party that would fit. The price is
    // idle seats behind a large party.
    if (party.size > free) break;
    // A ready party holds its seats, so it can always check in.
    free -= party.size;
    ready.push(party);
  }
  return ready;
}

/** Seats neither in service nor held by a ready party. */
export function seatsAvailable(waitlist: Waitlist, now: Date): number {
  const seated = waitlist.parties.filter((party) => isInService(party, now));
  const held = readyParties(waitlist, now);
  // The ready rule never takes more seats than are free; the clamp only keeps
  // the count honest if stored data is ever inconsistent.
  return Math.max(0, seatCount - totalSize(seated) - totalSize(held));
}

/** Where a party stands right now, derived from the stored facts. */
export type PartyState =
  | { kind: "waiting"; ahead: number }
  | { kind: "ready"; checkInBy: Date }
  | { kind: "in-service" }
  | { kind: "done" }
  | { kind: "left" }
  | { kind: "expired" };

export function partyState(
  waitlist: Waitlist,
  token: string,
  now: Date,
): PartyState | undefined {
  const timeline = replay(waitlist, now);
  const place = placeIn(waitlist, token, timeline);
  if (!place) return undefined;
  const { party, ahead } = place;
  if (party.leftAt) return { kind: "left" };
  if (isInService(party, now)) return { kind: "in-service" };
  if (isDone(party, now)) return { kind: "done" };
  if (ranOut(party, timeline)) return { kind: "expired" };
  if (timeline.ready.includes(party)) {
    const checkInBy = new Date(deadline(party, timeline.readySince));
    return { kind: "ready", checkInBy };
  }
  return { kind: "waiting", ahead };
}

export type CheckInResult =
  | { ok: true; waitlist: Waitlist; party: Party }
  | { ok: false; reason: "not-found" | "not-ready" | "already-checked-in" };

/**
 * Checks the party in, only if its table is ready right now. A ready party
 * holds its seats, so checking it in can never overbook. The service reruns
 * this inside the versioned write, so a check-in decided on an old snapshot
 * is checked again against the latest one.
 */
export function checkIn(
  waitlist: Waitlist,
  token: string,
  now: Date,
): CheckInResult {
  const party = waitlist.parties.find((p) => p.token === token);
  if (!party) return { ok: false, reason: "not-found" };
  if (party.checkedInAt) return { ok: false, reason: "already-checked-in" };
  if (partyState(waitlist, token, now)?.kind !== "ready") {
    return { ok: false, reason: "not-ready" };
  }

  const checkedIn: Party = { ...party, checkedInAt: now };
  const parties = waitlist.parties.map((p) => (p === party ? checkedIn : p));
  return { ok: true, waitlist: { parties }, party: checkedIn };
}

export type LeaveWaitlistResult =
  | { ok: true; waitlist: Waitlist; party: Party }
  | { ok: false; reason: "not-found" | "seated" | "already-left" };

/**
 * Takes a waiting or ready party off the queue. The party stays in the list
 * with its `leftAt`, a fact like every other, rather than being deleted. A
 * party that has checked in has no place in the queue left to give up.
 */
export function leaveWaitlist(
  waitlist: Waitlist,
  token: string,
  now: Date,
): LeaveWaitlistResult {
  const party = waitlist.parties.find((p) => p.token === token);
  if (!party) return { ok: false, reason: "not-found" };
  if (party.leftAt) return { ok: false, reason: "already-left" };
  if (party.checkedInAt) return { ok: false, reason: "seated" };

  const left: Party = { ...party, leftAt: now };
  const parties = waitlist.parties.map((p) => (p === party ? left : p));
  return { ok: true, waitlist: { parties }, party: left };
}
