import { afterEach, describe, expect, it, vi } from 'vitest'

const originalAllowedFlags = Object.getOwnPropertyDescriptor(
  process,
  'allowedNodeEnvironmentFlags'
)

describe('Vitest worker Node options', () => {
  afterEach(() => {
    if (originalAllowedFlags) {
      Object.defineProperty(process, 'allowedNodeEnvironmentFlags', originalAllowedFlags)
    }
    vi.resetModules()
  })

  it.each([
    ['unsupported', new Set<string>(), []],
    [
      'supported',
      new Set(['--no-experimental-webstorage']),
      ['--no-experimental-webstorage']
    ]
  ])('uses the webstorage flag when it is %s', async (_support, allowedFlags, expected) => {
    Object.defineProperty(process, 'allowedNodeEnvironmentFlags', { value: allowedFlags })
    vi.resetModules()

    const config = (await import('./vitest.config')).default

    expect(typeof config).toBe('object')
    if (typeof config !== 'object' || config === null) throw new Error('Expected object config')
    expect(config.test?.execArgv).toEqual(expected)
  })
})
