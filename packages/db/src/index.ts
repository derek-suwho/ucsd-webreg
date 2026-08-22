import { PrismaClient } from '@prisma/client'
import { requireProductionDatabaseUrl } from '@webreg/config'

export * from '@prisma/client'

export function createPrismaClient(
  environment: Record<string, string | undefined> = process.env
): PrismaClient {
  const databaseUrl = environment.NODE_ENV === 'production'
    ? requireProductionDatabaseUrl(environment.DATABASE_URL)
    : environment.DATABASE_URL
  return databaseUrl
    ? new PrismaClient({ datasourceUrl: databaseUrl })
    : new PrismaClient()
}

export const prisma = createPrismaClient()
