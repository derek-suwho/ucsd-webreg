// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plannerStore } from '@/lib/store'
import * as guestStorage from '@/lib/guest-storage'
import ImportGuestDialog from './ImportGuestDialog'

describe('ImportGuestDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    plannerStore.setState({
      termId: 'FA26',
      authed: true,
      schedules: [],
      activeScheduleId: null,
      lastError: null
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('blocks every dismiss path and default creation while import is busy', async () => {
    guestStorage.save({
      version: 2,
      terms: {
        WI27: {
          schedules: [{ id: 'guest-wi', name: 'Winter', sectionIds: [] }],
          activeScheduleId: 'guest-wi'
        }
      }
    })
    let finishImport!: () => void
    const importPending = new Promise<void>(resolve => { finishImport = resolve })
    vi.spyOn(plannerStore.getState(), 'importGuestSchedules').mockReturnValue(importPending)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/schedules?term=FA26') {
        return new Response(JSON.stringify({ schedules: [] }), { status: 200 })
      }
      if (url === '/api/schedules' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'default', termId: 'FA26', name: 'My Schedule', items: []
        }), { status: 201 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => {
      root.render(<ImportGuestDialog authed />)
      await Promise.resolve()
    })
    const importButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Import')!

    act(() => {
      importButton.click()
      importButton.click()
      container.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await act(async () => Promise.resolve())

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    const discard = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Discard') as HTMLButtonElement
    const busyImport = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'Importing…') as HTMLButtonElement
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(close.disabled).toBe(true)
    expect(discard.disabled).toBe(true)
    expect(busyImport.disabled).toBe(true)
    expect(plannerStore.getState().importGuestSchedules).toHaveBeenCalledTimes(1)
    expect(close.className).toContain('min-h-11')
    expect(discard.className).toContain('min-h-11')
    expect(busyImport.className).toContain('min-h-11')

    act(() => {
      close.click()
      discard.click()
      container.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await act(async () => Promise.resolve())

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      finishImport()
      await importPending
    })
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/schedules' && init?.method === 'POST')).toBe(false)
  })

  it('reports fire-and-forget account setup failures instead of leaking a rejection', async () => {
    guestStorage.save({
      version: 2,
      terms: {
        FA26: {
          schedules: [{ id: 'guest-fa', name: 'Fall', sectionIds: [] }],
          activeScheduleId: 'guest-fa'
        }
      }
    })
    vi.spyOn(plannerStore.getState(), 'refetchSchedules').mockResolvedValue()
    vi.spyOn(plannerStore.getState(), 'createSchedule').mockRejectedValue(new Error('offline'))

    await act(async () => {
      root.render(<ImportGuestDialog authed />)
      await Promise.resolve()
    })
    const discard = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === 'Discard')!
    await act(async () => {
      discard.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(plannerStore.getState().lastError).toContain('Could not finish account schedule setup')
  })
})
