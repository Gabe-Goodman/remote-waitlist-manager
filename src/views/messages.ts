// Every word a diner reads, in one place, so wording changes never touch
// the rules or the routes.
import {
  maxEmailLength,
  maxNameLength,
  type FieldErrors,
  type PartyState,
} from "../domain/waitlist.js";

export const messages = {
  joinTitle: "Join the waitlist",
  joinIntro: "Leave your details and keep this page open to see your place.",
  nameLabel: "Name",
  emailLabel: "Email",
  sizeLabel: "Party size",
  sizePlaceholder: "Choose…",
  joinButton: "Join the waitlist",
  // A count only, never names: who else is waiting is nobody's business.
  waiting: (count: number) =>
    count === 0
      ? "No one is waiting right now."
      : count === 1
        ? "1 party is waiting."
        : `${count} parties are waiting.`,
  partyLine: (name: string, size: number) => `${name}, party of ${size}`,
  ahead: (count: number) =>
    count === 0
      ? "You're next. Stay close and keep this page open."
      : count === 1
        ? "1 party ahead of you."
        : `${count} parties ahead of you.`,
  checkInNow: "Check in now.",
  checkInButton: "Check in",
  enjoyMeal: "Enjoy your meal.",
  joinAgain: "Join the waitlist again",
  leave: "Leave the waitlist",
  leaveWarning:
    "Your place can't be restored. If you join again, you'll go to the back of the waitlist.",
  leaveButton: "Yes, leave",
  partyLinkLabel: "Your party's link",
  partyLinkHint:
    "Share it with the rest of your party, or open it on another device. Anyone with this link can see your place on the waitlist and check in for you.",
  copyLink: "Copy link",
  copiedLink: "Link copied",
  errorTitle: "Something went wrong",
  tryAgain: "Try again",
} as const;

/**
 * The card's heading, which is also the page's title, for each state. No
 * full stops, like every heading and tab title; the one exclamation mark is
 * the news the diner is waiting for.
 */
export const cardTitles: Record<PartyState["kind"], string> = {
  waiting: "You're on the waitlist",
  ready: "Your table is ready!",
  "in-service": "You're checked in",
  done: "Thanks for dining",
  left: "You've left the waitlist",
};

/** Form-level notices, shown in the box at the top of the form. */
export type Notice = "fix-fields" | "duplicate" | "busy";

export const noticeMessages: Record<Notice, string> = {
  "fix-fields": "Please fix the highlighted fields below.",
  duplicate: "A party with this email is already on the waitlist.",
  busy: "Lots of people are joining right now. Please tap Join again.",
};

// One message for every error code the domain can return: a new code
// without wording here is a type error.
type FieldErrorMessages = {
  [Field in keyof FieldErrors]-?: Record<
    NonNullable<FieldErrors[Field]>,
    string
  >;
};

export const fieldErrorMessages: FieldErrorMessages = {
  name: {
    required: "Please enter a name for your party.",
    "too-long": `Please keep the name to ${maxNameLength} characters or fewer.`,
  },
  email: {
    required: "Please enter your email address.",
    "too-long": `Please keep the email to ${maxEmailLength} characters or fewer.`,
    invalid: "Please enter an email address like name@example.com.",
  },
  size: {
    invalid: "Please choose your party size.",
  },
};
