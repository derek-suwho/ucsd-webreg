import type { CatalogSource } from '@webreg/catalog'
import type { Env } from '@webreg/config'
import { SocFetcher } from '../fetcher.js'
import { createFixtureSource } from './fixture.js'
import { LegacySocSource } from './legacy-soc.js'
import { TSS_SOURCE_DISABLED } from './tss.js'

type FactoryDependencies = {
  fixtureFactory?: () => CatalogSource
  legacyFetcherFactory?: () => SocFetcher
}

export function createCatalogSource(
  workerEnv: Env,
  dependencies: FactoryDependencies = {}
): CatalogSource {
  switch (workerEnv.CATALOG_SOURCE) {
    case 'fixture':
      return (dependencies.fixtureFactory ?? createFixtureSource)()
    case 'legacy-soc': {
      const fetcher = (dependencies.legacyFetcherFactory ?? (() => new SocFetcher({
        contactEmail: workerEnv.CONTACT_EMAIL
      })))()
      return new LegacySocSource(fetcher)
    }
    case 'tss':
      throw new Error(TSS_SOURCE_DISABLED)
  }
}
