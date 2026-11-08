// The one `/` page: the party's card, in whatever state the party is in,
// when this browser has a party on the waitlist; otherwise the join form,
// with what the diner typed and any errors when a join was refused.
import {
  maxEmailLength,
  maxNameLength,
  maxPartySize,
  type FieldErrors,
  type JoinForm,
  type Party,
  type PartyState,
} from "../domain/waitlist.js";
import { copyLinkJs, liveCardJs } from "./browserFiles.js";
import { toHtml } from "./html.js";
import { Layout } from "./layout.js";
import {
  cardTitles,
  fieldErrorMessages,
  messages,
  noticeMessages,
  type Notice,
} from "./messages.js";
import { PartyCard } from "./partyCard.js";

// TableKit's alert colours: busy isn't the diner's mistake, so it's a
// warning, not an error.
const noticeVariants: Record<Notice, "error" | "warning"> = {
  "fix-fields": "error",
  duplicate: "error",
  busy: "warning",
};

const partySizes = Array.from({ length: maxPartySize }, (_, i) => i + 1);

// Either the party's card, or the join form with the waiting count: the
// form can't be shown without the count. The form always comes with its
// values, joinKey included: the route makes the key, views make no tokens.
type PartyPageProps = {
  party: Party;
  state: PartyState;
  origin: string;
};
type JoinPageProps = {
  party?: undefined;
  waiting: number;
  // What the form shows: empty for a newcomer, what the diner typed when a
  // join was refused, or a finished party's name and email.
  values: JoinForm;
  // A refused join's field errors and the notice above the form.
  errors?: FieldErrors;
  notice?: Notice;
};
type WaitlistPageProps = PartyPageProps | JoinPageProps;

// The pages as HTML, ready to send: the routes pass data and get a string
// back, so everything about rendering stays in views/.
export function partyPage(props: PartyPageProps): string {
  return toHtml(<WaitlistPage {...props} />);
}

export function joinPage(props: JoinPageProps): string {
  return toHtml(<WaitlistPage {...props} />);
}

function WaitlistPage(props: WaitlistPageProps) {
  if (props.party) {
    return (
      <Layout
        title={cardTitles[props.state.kind]}
        script={`${copyLinkJs}\n${liveCardJs}`}
      >
        <PartyCard
          party={props.party}
          state={props.state}
          origin={props.origin}
        />
      </Layout>
    );
  }

  const { waiting, values, notice } = props;
  const errors = props.errors ?? {};
  const nameError = errors.name && fieldErrorMessages.name[errors.name];
  const emailError = errors.email && fieldErrorMessages.email[errors.email];
  const sizeError = errors.size && fieldErrorMessages.size[errors.size];
  // Only a size from the list is kept; anything else goes back to "Choose…".
  const size = partySizes.map(String).includes(values.size) ? values.size : "";

  return (
    <Layout title={messages.joinTitle}>
      <h1>{messages.joinTitle}</h1>
      <p className="waiting">{messages.waiting(waiting)}</p>
      <p className="secondary">{messages.joinIntro}</p>
      {/* noValidate: every error comes from the server, worded the same way
          in every browser. */}
      <form method="post" action="/parties" noValidate>
        {/* Which rendering of the form this is: a double tap or a resent
            copy lands on the party it already made, instead of being
            refused as a duplicate of the diner's own email. */}
        <input type="hidden" name="joinKey" value={values.joinKey} />
        {notice && (
          <div
            role="alert"
            className="alert"
            data-variant={noticeVariants[notice]}
            data-layout="text-only"
          >
            {noticeMessages[notice]}
          </div>
        )}
        {/* data-stretch: TableKit's fields are 220px wide unless stretched
            to the full width of the form. */}
        <label htmlFor="name">{messages.nameLabel}</label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          maxLength={maxNameLength}
          required
          data-stretch
          defaultValue={values.name}
          {...errorAttributes("name", nameError)}
        />
        <FieldError id="name-error" message={nameError} />
        <label htmlFor="email">{messages.emailLabel}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={maxEmailLength}
          required
          data-stretch
          defaultValue={values.email}
          {...errorAttributes("email", emailError)}
        />
        <FieldError id="email-error" message={emailError} />
        <label htmlFor="size">{messages.sizeLabel}</label>
        {/* Starts on "Choose…" so a diner who skips it gets the size error
            instead of silently joining as a party of 1. Disabled, so it
            can't be picked back. */}
        <select
          id="size"
          name="size"
          defaultValue={size}
          required
          data-stretch
          {...errorAttributes("size", sizeError)}
        >
          <option value="" disabled>
            {messages.sizePlaceholder}
          </option>
          {partySizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <FieldError id="size-error" message={sizeError} />
        <button type="submit">{messages.joinButton}</button>
      </form>
    </Layout>
  );
}

// aria-invalid and aria-describedby: screen readers announce the field as
// invalid and read its error with it. data-variant: TableKit's red border.
function errorAttributes(field: string, error: string | undefined) {
  return error
    ? {
        "aria-invalid": true,
        "aria-describedby": `${field}-error`,
        "data-variant": "error",
      }
    : {};
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}
