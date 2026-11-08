// The page shown when something goes wrong: what happened and one thing to
// do about it, never the error's details.
import { toHtml } from "./html.js";
import { Layout } from "./layout.js";
import { messages } from "./messages.js";

// The page as HTML, ready to send.
export function errorPage(): string {
  return toHtml(<ErrorPage />);
}

function ErrorPage() {
  return (
    <Layout title={messages.errorTitle}>
      <h1>{messages.errorTitle}</h1>
      {/* The diner's only useful move is to try again; / reloads the
          waitlist, or this page if the problem persists. */}
      <p>
        <a href="/">{messages.tryAgain}</a>
      </p>
    </Layout>
  );
}
