import { Prisma } from '@webreg/db'

// Retries a Serializable-isolation transaction once on a serialization failure (P2034).
export async function withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return fn()
    }
    throw err
  }
}
