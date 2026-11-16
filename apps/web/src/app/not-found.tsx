import "./globals.css";

/** Shown for addresses outside the language routes. Most visitors see [locale]/not-found instead. */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <main className="container section">
          <h1>Page not found</h1>
          <p className="lead">The page you were looking for doesn&apos;t exist or has moved.</p>
          <a className="btn btn-primary" href="/">
            Go to the home page
          </a>
        </main>
      </body>
    </html>
  );
}
