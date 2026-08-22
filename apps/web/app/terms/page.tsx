import Link from 'next/link'

export default function TermsPage() {
  return (
    <article className="mx-auto min-h-screen max-w-3xl bg-wr-ui-content-bg px-4 py-8 text-ink sm:px-6">
      <header className="border-b border-wr-ui-content-border pb-4">
        <Link href="/" className="text-[length:var(--font-size-wr-small)] font-bold text-wr-link underline hover:text-wr-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent">
          Course Planner
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Terms</h1>
        <p className="mt-1 text-[length:var(--font-size-wr-small)] text-ink-muted">Last updated August 22, 2026</p>
      </header>

      <div className="space-y-6 py-6 text-sm leading-6">
        <section>
          <h2 className="text-base font-bold">Planning only</h2>
          <p className="mt-1">
            Course Planner is an independent schedule-planning aid. It cannot enroll, drop, waitlist, reserve a seat, or change any university record. Use the official university system for every registration action.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold">Verify course information</h2>
          <p className="mt-1">
            When the planner is labeled Demo, its catalog comes from fixture data rather than a current university feed. Check the catalog status and generated timestamp shown in the planner. Regardless of source, course offerings, seat counts, instructors, meeting times, cancellations, and final-exam details can be stale, incomplete, or wrong. Verify all details in the official UC San Diego system before making decisions.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold">Independent project</h2>
          <p className="mt-1">
            This project is not affiliated with or endorsed by the University of California, UC San Diego, or its registration services. It does not use the university logo. Familiar interface patterns do not imply an official relationship.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold">Availability</h2>
          <p className="mt-1">
            Access may be limited or interrupted for maintenance, security, abuse prevention, or service failures. Do not rely on this planner as the sole copy of a schedule or for a time-sensitive registration action.
          </p>
        </section>

        <p>
          The <Link href="/privacy" className="font-bold text-wr-link underline hover:text-wr-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent">Privacy page</Link> explains what data the planner handles and how account export and deletion work.
        </p>
      </div>
    </article>
  )
}
