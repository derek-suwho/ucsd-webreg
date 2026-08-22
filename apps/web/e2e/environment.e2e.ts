import { expect, test } from '@playwright/test'
import { requireE2eDatabaseUrl } from './environment'

test('database guard accepts only a dedicated PostgreSQL E2E database', () => {
  expect(requireE2eDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://user:pass@localhost:5432/planner_e2e' })).toBe(
    'postgresql://user:pass@localhost:5432/planner_e2e'
  )
  for (const value of [
    undefined,
    'not-a-url',
    'mysql://user:pass@localhost/planner_e2e',
    'postgresql://user:pass@localhost/webreg'
  ]) {
    expect(() => requireE2eDatabaseUrl({ TEST_DATABASE_URL: value })).toThrow(/e2e|PostgreSQL/i)
  }
})
