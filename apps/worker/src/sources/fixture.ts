import { FixtureCatalogSource } from '@webreg/catalog'
import fixture from '../../../../packages/catalog/fixtures/fa26-demo.json' with { type: 'json' }

export function createFixtureSource(): FixtureCatalogSource {
  return new FixtureCatalogSource(fixture)
}
