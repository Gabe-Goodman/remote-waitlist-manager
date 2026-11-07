// The HTML shell every page shares: phone-sized, readable, no scripts.
import type { ReactNode } from "react";

// Inputs at 16px or more, so phones don't zoom in when a field is tapped.
const styles = `
  body { font: 1.0625rem/1.5 system-ui, sans-serif; margin: 0; }
  main { max-width: 30rem; margin: 0 auto; padding: 1.25rem; }
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input, select, button { font: inherit; width: 100%; box-sizing: border-box;
    padding: 0.6rem; margin-top: 0.25rem; }
  button { margin-top: 1.5rem; font-weight: 600; }
  .notice { border: 2px solid #b00020; padding: 0.75rem; margin-top: 1rem; }
  .field-error { color: #b00020; margin: 0.25rem 0 0; }
  [aria-invalid="true"] { border: 2px solid #b00020; }
`;

export function Layout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{styles}</style>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
