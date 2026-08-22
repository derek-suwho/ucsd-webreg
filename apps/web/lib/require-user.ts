import { auth } from './auth'

// Throws a 401 Response when unauthenticated; callers must catch and return it.
export async function requireUser(): Promise<{ id: string }> {
  const session = await auth()
  const id = session?.user?.id
  if (!id) {
    throw Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return { id }
}
