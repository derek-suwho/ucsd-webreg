import { auth, signIn, signOut } from '@/lib/auth'
import AccountDataActions from '@/components/AccountDataActions'

export default async function AuthButton() {
  const session = await auth()

  if (!session?.user) {
    return (
      <form
        action={async () => {
          'use server'
          await signIn('google')
        }}
      >
        <button type="submit" className="wr-btn min-h-11 min-w-11">
          Sign in with Google
        </button>
      </form>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <span className="max-w-full break-all text-[length:var(--font-size-wr-small)] text-wr-header-text/85">
        {session.user.name ?? session.user.email}
      </span>
      <div data-account-actions className="min-w-0">
        <AccountDataActions />
      </div>
      <form
        action={async () => {
          'use server'
          await signOut()
        }}
      >
        <button type="submit" className="wr-btn min-h-11 min-w-11">
          Sign out
        </button>
      </form>
    </div>
  )
}
