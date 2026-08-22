import { describe, expect, it, vi } from 'vitest'
import type { Env } from '@webreg/config'
import type { SocFetcher } from '../fetcher.js'
import { LegacySocSource } from './legacy-soc.js'
import { TSS_SOURCE_DISABLED, TssSource } from './tss.js'
import { createCatalogSource } from './factory.js'

const baseEnv: Env = {
  DATABASE_URL: 'postgresql://example',
  CONTACT_EMAIL: 'ops@example.test',
  CATALOG_SOURCE: 'fixture'
}

describe('createCatalogSource', () => {
  it('creates fixture mode without constructing or bootstrapping a network fetcher', async () => {
    const legacyFetcherFactory = vi.fn(() => {
      throw new Error('network fetcher must stay lazy')
    })

    const source = createCatalogSource(baseEnv, { legacyFetcherFactory })

    expect(source.kind).toBe('fixture')
    expect(source.knownTermIds).toEqual(['FA26'])
    await expect(source.listTerms()).resolves.toMatchObject([{ id: 'FA26' }])
    expect(legacyFetcherFactory).not.toHaveBeenCalled()
  })

  it('creates legacy mode only for its explicit pre-FA26 allowlist', async () => {
    const bootstrap = vi.fn(async () => {})
    const fetchDepartmentList = vi.fn(async () => ['CSE'])
    const fetchResultPage = vi.fn(async () => '<html></html>')
    const fetcher = { bootstrap, fetchDepartmentList, fetchResultPage } as unknown as SocFetcher
    const source = new LegacySocSource(fetcher, [{
      id: 'SP26',
      name: 'Spring Quarter 2026',
      startsAt: '2026-03-25',
      endsAt: '2026-06-05'
    }])
    expect(source.knownTermIds).toEqual(['SP26'])

    await expect(source.fetchDepartment('FA26', 'CSE')).rejects.toThrow('Legacy SoC term not allowed: FA26')
    await expect(source.fetchDepartment('WI27', 'CSE')).rejects.toThrow('Legacy SoC term not allowed: WI27')
    expect(bootstrap).not.toHaveBeenCalled()
    expect(fetchResultPage).not.toHaveBeenCalled()

    await expect(source.listTerms()).resolves.toMatchObject([{
      id: 'SP26',
      departments: ['CSE']
    }])
    expect(bootstrap).toHaveBeenCalledOnce()
  })

  it('runs legacy seat refresh behind the term advisory lock', async () => {
    const fetcher = {
      bootstrap: vi.fn(async () => {}),
      fetchDepartmentList: vi.fn(async () => []),
      fetchResultPage: vi.fn(async () => '')
    } as unknown as SocFetcher
    const source = new LegacySocSource(fetcher)
    const operation = vi.fn(async () => {})
    const withLock = vi.fn(async (_termId: string, run: () => Promise<unknown>) => ({
      acquired: true,
      value: await run()
    }))

    await source.refreshSeats({ operation, withLock })

    expect(fetcher.bootstrap).toHaveBeenCalledOnce()
    expect(withLock).toHaveBeenCalledWith('SP26', expect.any(Function))
    expect(operation).toHaveBeenCalledWith(fetcher, 'SP26', { snapshotLimits: undefined })
  })

  it('rejects a skipped legacy seat lock', async () => {
    const fetcher = {
      bootstrap: vi.fn(async () => {}), fetchDepartmentList: vi.fn(async () => []), fetchResultPage: vi.fn(async () => '')
    } as unknown as SocFetcher
    const source = new LegacySocSource(fetcher)
    await expect(source.refreshSeats({
      operation: vi.fn(async () => {}),
      withLock: async () => ({ acquired: false })
    })).rejects.toThrow('catalog_lock_skipped')
  })

  it('keeps TSS disabled even when credential-like keys are supplied', async () => {
    const unsafeEnv = {
      ...baseEnv,
      CATALOG_SOURCE: 'tss',
      TSS_PASSWORD: 'secret',
      TSS_COOKIE: 'session',
      TSS_TOKEN: 'token'
    } as unknown as Env

    expect(() => createCatalogSource(unsafeEnv)).toThrow(TSS_SOURCE_DISABLED)

    const source = new TssSource()
    await expect(source.listTerms()).rejects.toThrow(TSS_SOURCE_DISABLED)
    await expect(source.fetchDepartment('FA26', 'CSE')).rejects.toThrow(TSS_SOURCE_DISABLED)
  })
})
