import { describe, it, expect, vi } from 'vitest'
import { executeCliCommand, parseCliArgs, runCliSync } from './cli.js'

describe('parseCliArgs', () => {
  it('parses a valid add-term command', () => {
    const result = parseCliArgs(['add-term', 'FA26', 'Fall Quarter 2026', '2026-09-24', '2026-12-04'])
    expect(result).toEqual({
      command: 'add-term',
      id: 'FA26',
      name: 'Fall Quarter 2026',
      startsAt: '2026-09-24',
      endsAt: '2026-12-04'
    })
  })

  it('rejects a bad term id', () => {
    const result = parseCliArgs(['add-term', 'fall26', 'Fall Quarter 2026', '2026-09-24', '2026-12-04'])
    expect(result.command).toBe('error')
  })

  it('rejects a badly formatted date', () => {
    const result = parseCliArgs(['add-term', 'FA26', 'Fall Quarter 2026', '09/24/2026', '2026-12-04'])
    expect(result.command).toBe('error')
  })

  it('rejects an unreal date', () => {
    const result = parseCliArgs(['add-term', 'FA26', 'Fall Quarter 2026', '2026-13-40', '2026-12-04'])
    expect(result.command).toBe('error')
  })

  it('rejects endsAt before startsAt', () => {
    const result = parseCliArgs(['add-term', 'FA26', 'Fall Quarter 2026', '2026-12-04', '2026-09-24'])
    expect(result.command).toBe('error')
  })

  it('parses a valid sync command', () => {
    const result = parseCliArgs(['sync', 'FA26'])
    expect(result).toEqual({ command: 'sync', termId: 'FA26' })
  })

  it('parses a valid deactivate command', () => {
    const result = parseCliArgs(['deactivate', 'FA26'])
    expect(result).toEqual({ command: 'deactivate', termId: 'FA26' })
  })

  it('errors on an unknown command', () => {
    const result = parseCliArgs(['frobnicate', 'FA26'])
    expect(result.command).toBe('error')
  })
})

describe('runCliSync', () => {
  it('selects one configured source term and routes through source sync', async () => {
    const source = {
      kind: 'fixture' as const,
      knownTermIds: ['FA26', 'WI27'],
      listTerms: vi.fn(async () => [
        { id: 'FA26', name: 'Fall', startsAt: '2026-09-24', endsAt: '2026-12-04', departments: ['DEMO'], sourceGeneratedAt: '2026-08-21T00:00:00Z' },
        { id: 'WI27', name: 'Winter', startsAt: '2027-01-04', endsAt: '2027-03-12', departments: ['DEMO'], sourceGeneratedAt: '2026-08-21T00:00:00Z' }
      ]),
      fetchDepartment: vi.fn(async () => [])
    }
    const summary = { terms: [{ termId: 'FA26', okDepts: ['DEMO'], failedDepts: [] }] }
    const sync = vi.fn(async selected => {
      expect(await selected.listTerms()).toHaveLength(1)
      expect((await selected.listTerms())[0].id).toBe('FA26')
      return summary
    })
    const env = { DATABASE_URL: 'postgresql://x', CONTACT_EMAIL: 'ops@example.com', CATALOG_SOURCE: 'fixture' as const }

    await expect(runCliSync('FA26', {
      loadWorkerEnv: () => env,
      createSource: () => source,
      sync
    })).resolves.toEqual(summary)
    expect(sync).toHaveBeenCalledOnce()
    expect(source.fetchDepartment).not.toHaveBeenCalled()
  })

  it('rejects a term absent from the configured source', async () => {
    await expect(runCliSync('FA26', {
      loadWorkerEnv: () => ({ DATABASE_URL: 'postgresql://x', CONTACT_EMAIL: 'ops@example.com', CATALOG_SOURCE: 'fixture' }),
      createSource: () => ({ kind: 'fixture', knownTermIds: [], listTerms: async () => [], fetchDepartment: async () => [] })
    })).rejects.toThrow('catalog_term_unavailable')
  })
})

describe('executeCliCommand', () => {
  it('writes the sync summary and failed departments on lock success', async () => {
    const log = vi.fn()
    const runSync = vi.fn(async () => ({
      terms: [{ termId: 'FA26', okDepts: ['CSE'], failedDepts: ['MATH'] }]
    }))

    await expect(
      executeCliCommand(
        { command: 'sync', termId: 'FA26' },
        { runSync, log, error: vi.fn() }
      )
    ).resolves.toBe(0)

    expect(runSync).toHaveBeenCalledWith('FA26')
    expect(log.mock.calls).toEqual([
      ['sync FA26: ok=1 failed=1'],
      ['failed depts: MATH']
    ])
  })

  it('propagates lock failures without a false success log', async () => {
    const log = vi.fn()
    const failure = new Error('catalog_lock_skipped')
    const runSync = vi.fn(async () => { throw failure })
    await expect(executeCliCommand(
      { command: 'sync', termId: 'FA26' },
      { runSync, log, error: vi.fn() }
    )).rejects.toBe(failure)
    expect(log).not.toHaveBeenCalled()
  })
})
