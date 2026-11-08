// The waitlist's rules: pure functions. No database, no clock, no HTTP;
// the current time and new tokens are passed in.

/** The join form as submitted: every field is text until validated. */
export type JoinForm = { name: string; email: string; size: string };

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

export function validateJoin(form: JoinForm): JoinValidation {
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
};

/** The queue, in order: the first party joined first. */
export type Waitlist = { parties: readonly Party[] };

/** What joining needs from outside the rules: the current time and a new token. */
export type JoinContext = { now: Date; token: string };

export type JoinResult =
  | { ok: true; waitlist: Waitlist; party: Party }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "duplicate" };

/**
 * Validates the form and adds the party at the back of the queue, unless
 * its email is already on the waitlist.
 */
export function join(
  waitlist: Waitlist,
  form: JoinForm,
  context: JoinContext,
): JoinResult {
  const validation = validateJoin(form);
  if (!validation.ok) {
    return { ok: false, reason: "invalid", errors: validation.errors };
  }

  // A party must never appear twice. Every party on the waitlist counts:
  // no party can leave or finish.
  const { email } = validation.details;
  if (waitlist.parties.some((party) => party.email === email)) {
    return { ok: false, reason: "duplicate" };
  }

  const party: Party = {
    token: context.token,
    ...validation.details,
    joinedAt: context.now,
  };
  return {
    ok: true,
    waitlist: { parties: [...waitlist.parties, party] },
    party,
  };
}

/**
 * How many parties a newcomer would have ahead of them: those still waiting
 * or ready. A party that has checked in has left the queue for its table.
 */
export function partiesWaiting(waitlist: Waitlist): number {
  return waitlist.parties.filter((party) => !party.checkedInAt).length;
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
    if (party.checkedInAt) continue;
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
  | { kind: "done" };

export function partyState(
  waitlist: Waitlist,
  token: string,
  now: Date,
): PartyState | undefined {
  const place = partyPlace(waitlist, token);
  if (!place) return undefined;
  const { party, ahead } = place;
  if (isInService(party, now)) return { kind: "in-service" };
  if (isDone(party, now)) return { kind: "done" };
  const ready = readyParties(waitlist, now);
  if (ready.some((r) => r.token === token)) return { kind: "ready" };
  return { kind: "waiting", ahead };
}
