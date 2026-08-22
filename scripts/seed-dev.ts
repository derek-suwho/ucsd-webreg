import { FixtureCatalogSource } from '@webreg/catalog'
import { prisma } from '@webreg/db'
import fixture from '../packages/catalog/fixtures/fa26-demo.json' with { type: 'json' }
import { syncCatalogSource } from '../apps/worker/src/source-sync.js'

async function main(): Promise<void> {
  const result = await syncCatalogSource(new FixtureCatalogSource(fixture))
  for (const term of result.terms) {
    console.log(`snapshot ${term.termId}: imported ${term.okDepts.length} demo departments`)
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : 'demo import failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
