// The pages shown when a request can't be answered as asked: something went
// wrong, or a link matches no party. Each says what happened and offers one
// thing to do about it, never an error's details.
import { toHtml } from "./html.js";
import { Layout } from "./layout.js";
import { messages } from "./messages.js";

// The page as HTML, ready to send. retryPath: where Try again goes, back to
// where the diner was (the route decides).
export function errorPage(retryPath: string): string {
  return toHtml(
    // The diner's only useful move is to try again; if the problem
    // persists, this page comes back.
    <PlainPage
      title={messages.errorTitle}
      link={{ href: retryPath, label: messages.tryAgain }}
    />,
  );
}

// A link to a party that isn't on the waitlist: a visit that's over, or a
// link cut off on its way. Both choices go to /, labelled by what the diner
// will find there: their own party, or the join form.
export function unknownPartyPage(hasParty: boolean): string {
  return toHtml(
    <PlainPage
      title={messages.unknownPartyTitle}
      text={messages.unknownPartyText}
      link={{
        href: "/",
        label: hasParty ? messages.goToYourParty : messages.joinTheWaitlist,
      }}
    />,
  );
}

function PlainPage({
  title,
  text,
  link,
}: {
  title: string;
  text?: string;
  link: { href: string; label: string };
}) {
  return (
    <Layout title={title}>
      <h1>{title}</h1>
      {text && <p>{text}</p>}
      <p>
        <a href={link.href}>{link.label}</a>
      </p>
    </Layout>
  );
}
