// The page shown when something goes wrong: what happened and one thing to
// do about it, never the error's details.
import { toHtml } from "./html.js";
import { Layout } from "./layout.js";
import { messages } from "./messages.js";

// The page as HTML, ready to send. retryPath: where Try again goes, back to
// where the diner was (the route decides).
export function errorPage(retryPath: string): string {
  return toHtml(<ErrorPage retryPath={retryPath} />);
}

function ErrorPage({ retryPath }: { retryPath: string }) {
  return (
    <Layout title={messages.errorTitle}>
      <h1>{messages.errorTitle}</h1>
      {/* The diner's only useful move is to try again; if the problem
          persists, this page comes back. */}
      <p>
        <a href={retryPath}>{messages.tryAgain}</a>
      </p>
    </Layout>
  );
}
