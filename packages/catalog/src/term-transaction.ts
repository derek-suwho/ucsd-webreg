import { prisma, type Prisma } from '@webreg/db'

const CATALOG_TERM_LOCK_NAMESPACE = 'catalog-term-write'

export type CatalogTransaction = Prisma.TransactionClient

/** All production catalog reads+writes acquire this term lock as their first statement. */
export async function withTermCatalogTransaction<T>(
  termId: string,
  operation: (tx: CatalogTransaction) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${CATALOG_TERM_LOCK_NAMESPACE} || ':' || ${termId}, 0)
      ) IS NULL AS locked
    `
    return operation(tx)
  }, { maxWait: 10_000, timeout: 120_000 })
}
