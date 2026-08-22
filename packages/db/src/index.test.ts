import { describe, expect, it } from 'vitest'
import { createPrismaClient } from './index'

describe('production Prisma client', () => {
  it.each([
    undefined,
    'postgresql://web_runtime:secret@db.example.com:5432/webreg',
    'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=verify-full&sslaccept=strict'
  ])('fails startup before constructing Prisma for an unsafe URL %s', DATABASE_URL => {
    expect(() => createPrismaClient({ NODE_ENV: 'production', DATABASE_URL }))
      .toThrow('Production DATABASE_URL must use sslmode=require and sslaccept=strict')
  })

  it('constructs Prisma with the exact strict production contract', async () => {
    const client = createPrismaClient({
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict'
    })

    expect(client).toBeDefined()
    await client.$disconnect()
  })
})
