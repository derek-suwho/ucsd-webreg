import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FixtureCatalogSource } from '@webreg/catalog'
import { prisma } from '@webreg/db'
import { syncCatalogSource } from '../../worker/src/source-sync.js'

async function main(): Promise<void> {
  const fixture = JSON.parse(await readFile(resolve('packages/catalog/fixtures/fa26-demo.json'), 'utf8')) as {
    sourceGeneratedAt: string
    terms: Array<Record<string, unknown>>
  }
  const fall = fixture.terms[0]
  if (!fall) throw new Error('Demo fixture has no term')
  const winter = structuredClone(fall)
  Object.assign(winter, {
    id: 'WI27',
    name: 'Winter Quarter 2027 Demo',
    startsAt: '2027-01-04',
    endsAt: '2027-03-12'
  })

  await syncCatalogSource(new FixtureCatalogSource({
    sourceGeneratedAt: fixture.sourceGeneratedAt,
    terms: [fall, winter]
  }))
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : 'E2E seed failed')
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
