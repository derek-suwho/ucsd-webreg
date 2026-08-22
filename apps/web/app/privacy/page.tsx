import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <article className="mx-auto min-h-screen max-w-3xl bg-wr-ui-content-bg px-4 py-8 text-ink sm:px-6">
      <header className="border-b border-wr-ui-content-border pb-4">
        <Link href="/" className="text-[length:var(--font-size-wr-small)] font-bold text-wr-link underline hover:text-wr-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent">
          Course Planner
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-1 text-[length:var(--font-size-wr-small)] text-ink-muted">Last updated August 22, 2026</p>
      </header>

      <div className="space-y-6 py-6 text-sm leading-6">
        <section>
          <h2 className="text-base font-bold">What this planner handles</h2>
          <p className="mt-1">
            Signed-in accounts use Google authentication. The primary PostgreSQL database stores the verified email address and name supplied for the account, plus saved schedule names, term identifiers, and section identifiers. An encrypted sign-in session may also contain Google profile fields such as a profile image.
          </p>
          <p className="mt-2">
            This planner does not request or store TSS credentials, enrollment actions, grades, financial data, or other UC San Diego student records.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold">Guest and session data</h2>
          <p className="mt-1">
            Before sign-in, guest schedules are stored locally in your browser. They remain there unless you clear them or choose to import or discard them after signing in. Auth.js and the Google OAuth flow use cookies needed to maintain and protect a signed-in session.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold">Infrastructure and access controls</h2>
          <p className="mt-1">
            PostgreSQL holds primary account data. Short-lived Redis counters keyed to a user or IP address help enforce rate limits and resist abuse. Hosting and authentication providers process the technical data needed to operate those services.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold">Export and deletion</h2>
          <p className="mt-1">
            Signed-in users can export their portable schedule data or delete their account from the account controls. Deletion removes the live database profile, schedules, and schedule items. Deployment-provider backups and logs can have separate retention settings, so this source code cannot promise their immediate removal.
          </p>
          <p className="mt-2">Account data remains in the primary database until the account is deleted.</p>
        </section>

        <p>
          See the <Link href="/terms" className="font-bold text-wr-link underline hover:text-wr-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent">Terms</Link> for the planner&apos;s use and accuracy limits.
        </p>
      </div>
    </article>
  )
}
