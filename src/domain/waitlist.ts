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
  // Checked before validating: a matching key means this submission already
  // succeeded, whatever the copy sent now says. Only an active party counts,
  // so a finished party's old form can't bring it back.
  const joined =
    form.joinKey === ""
      ? undefined
      : waitlist.parties.find(
          (party) =>
            party.joinKey === form.joinKey && isActive(party, context.now),
        );
  if (joined) return { ok: true, waitlist, party: joined, created: false };

  const validation = validateJoin(form);
  if (!validation.ok) {
    return { ok: false, reason: "invalid", errors: validation.errors };
  }

  // A party must never appear twice while it holds a place. A party that
  // has finished its meal no longer counts, so the same diner can come back.
  const { email } = validation.details;
  const taken = waitlist.parties.some(
    (party) => party.email === email && isActive(party, context.now),
  );
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
 * and a party that left has given up its place.
 */
export function partiesWaiting(waitlist: Waitlist): number {
  return waitlist.parties.filter((party) => !party.checkedInAt && !party.leftAt)
    .length;
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
): PartyPlace | undefined {
  const index = waitlist.parties.findIndex((party) => party.token === token);
  const party = waitlist.parties[index];
  if (!party) return undefined;
  const inFront = { parties: waitlist.parties.slice(0, index) };
  return { party, ahead: partiesWaiting(inFront) };
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

// A finished party or one that left no longer holds a place, so its email
// can join again.
export function isActive(party: Party, now: Date): boolean {
  return !isDone(party, now) && !party.leftAt;
}

function totalSize(parties: readonly Party[]): number {
  return parties.reduce((sum, party) => sum + party.size, 0);
}

/**
 * The parties whose table is ready at `now`, in queue order. Derived from
 * stored facts, never stored: time alone frees seats, so a stale snapshot
 * can only under-count free seats, never overbook.
 */
export function readyParties(waitlist: Waitlist, now: Date): Party[] {
  const seated = waitlist.parties.filter((party) => isInService(party, now));
  let free = seatCount - totalSize(seated);
  const ready: Party[] = [];
  for (const party of waitlist.parties) {
    // A party that left holds no seats: they go to the next party that fits.
    if (party.checkedInAt || party.leftAt) continue;
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
  | { kind: "ready" }
  | { kind: "in-service" }
  | { kind: "done" }
  | { kind: "left" };

export function partyState(
  waitlist: Waitlist,
  token: string,
  now: Date,
): PartyState | undefined {
  const place = partyPlace(waitlist, token);
  if (!place) return undefined;
  const { party, ahead } = place;
  if (party.leftAt) return { kind: "left" };
  if (isInService(party, now)) return { kind: "in-service" };
  if (isDone(party, now)) return { kind: "done" };
  const ready = readyParties(waitlist, now);
  if (ready.some((r) => r.token === token)) return { kind: "ready" };
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
