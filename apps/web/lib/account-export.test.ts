// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('account export download', () => {
  it('downloads the validated export with a deterministic safe filename', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURL = vi.fn().mockReturnValue('blob:export')
    const revokeObjectURL = vi.fn()
    const BrowserURL = URL
    vi.stubGlobal('URL', Object.assign(
      class extends BrowserURL {},
      { createObjectURL, revokeObjectURL }
    ))
    const { downloadAccountExport } = await import('./account-export')
    const data = {
      schemaVersion: 1 as const,
      generatedAt: '2026-08-22T12:00:00.000Z',
      schedules: [{ termId: 'FA26', name: 'Primary', sectionIds: ['A'] }]
    }

    downloadAccountExport(data)

    const clicked = click.mock.instances[0] as HTMLAnchorElement
    expect(clicked.href).toBe('blob:export')
    expect(clicked.download).toBe('course-planner-schedules-2026-08-22.json')
    expect(click).toHaveBeenCalledTimes(1)
    expect(clicked.isConnected).toBe(false)
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
  })

  it('removes its temporary link and still defers URL cleanup when clicking throws', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('blocked') })
    const revokeObjectURL = vi.fn()
    const BrowserURL = URL
    vi.stubGlobal('URL', Object.assign(
      class extends BrowserURL {},
      { createObjectURL: vi.fn().mockReturnValue('blob:failed-export'), revokeObjectURL }
    ))
    const { downloadAccountExport } = await import('./account-export')

    expect(() => downloadAccountExport({
      schemaVersion: 1,
      generatedAt: '2026-08-22T12:00:00.000Z',
      schedules: []
    })).toThrow('blocked')
    expect(document.body.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed-export')
  })
})
