import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkReadiness } from './readiness'

describe('checkReadiness', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is ready only after PostgreSQL and Redis both respond', async () => {
    const calls: string[] = []

    await expect(checkReadiness({
      checkDatabase: async () => { calls.push('database') },
      checkRedis: async () => { calls.push('redis') }
    })).resolves.toBe(true)
    expect(calls.sort()).toEqual(['database', 'redis'])
  })

  it.each(['database', 'redis'] as const)('is not ready when %s fails', async dependency => {
    const unavailable = async () => { throw new Error('private connection details') }

    await expect(checkReadiness({
      checkDatabase: dependency === 'database' ? unavailable : async () => undefined,
      checkRedis: dependency === 'redis' ? unavailable : async () => undefined
    })).resolves.toBe(false)
  })

  it('bounds a dependency that never settles', async () => {
    vi.useFakeTimers()
    let finishDatabase: (() => void) | undefined
    const pending = checkReadiness({
      checkDatabase: () => new Promise<void>(resolve => { finishDatabase = resolve }),
      checkRedis: async () => undefined,
      timeoutMs: 25
    })

    await vi.advanceTimersByTimeAsync(25)

    await expect(pending).resolves.toBe(false)
    finishDatabase?.()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('coalesces repeated checks while dependency work remains active', async () => {
    vi.useFakeTimers()
    let finishDatabase: (() => void) | undefined
    let blockDatabase = true
    const checkDatabase = vi.fn(() => blockDatabase
      ? new Promise<void>(resolve => { finishDatabase = resolve })
      : Promise.resolve())
    const checkRedis = vi.fn(async () => undefined)
    const dependencies = { checkDatabase, checkRedis, timeoutMs: 25 }

    const first = checkReadiness(dependencies)
    const second = checkReadiness(dependencies)
    await vi.advanceTimersByTimeAsync(25)
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])

    const third = checkReadiness(dependencies)
    await vi.advanceTimersByTimeAsync(25)
    await expect(third).resolves.toBe(false)
    expect(checkDatabase).toHaveBeenCalledOnce()
    expect(checkRedis).toHaveBeenCalledOnce()

    blockDatabase = false
    finishDatabase?.()
    await vi.advanceTimersByTimeAsync(0)
    await expect(checkReadiness(dependencies)).resolves.toBe(true)
    expect(checkDatabase).toHaveBeenCalledTimes(2)
  })

  it('keeps failed probes coalesced until every dependency settles', async () => {
    vi.useFakeTimers()
    let finishRedis: (() => void) | undefined
    const checkDatabase = vi.fn(async () => { throw new Error('database unavailable') })
    const checkRedis = vi.fn(() => new Promise<void>(resolve => { finishRedis = resolve }))
    const dependencies = { checkDatabase, checkRedis, timeoutMs: 25 }

    const first = checkReadiness(dependencies)
    await vi.advanceTimersByTimeAsync(25)
    await expect(first).resolves.toBe(false)
    const second = checkReadiness(dependencies)
    await vi.advanceTimersByTimeAsync(25)
    await expect(second).resolves.toBe(false)
    expect(checkDatabase).toHaveBeenCalledOnce()
    expect(checkRedis).toHaveBeenCalledOnce()

    finishRedis?.()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('clears timeout resources after successful probes', async () => {
    vi.useFakeTimers()

    await checkReadiness({
      checkDatabase: async () => undefined,
      checkRedis: async () => undefined,
      timeoutMs: 25
    })

    expect(vi.getTimerCount()).toBe(0)
  })
})
