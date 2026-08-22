// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plannerStore } from '@/lib/store'
import SyncStatus from './SyncStatus'

describe('SyncStatus', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    plannerStore.setState({ authed: true, scheduleSync: { s1: 'pending' } })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('shows honest save states and retries a failed active schedule', async () => {
    const retry = vi.spyOn(plannerStore.getState(), 'retryScheduleSave').mockResolvedValue()
    await act(async () => root.render(<SyncStatus scheduleId="s1" />))
    expect(container.textContent).toBe('Saving…')

    await act(async () => plannerStore.setState({ scheduleSync: { s1: 'saved' } }))
    expect(container.textContent).toBe('Saved')

    await act(async () => plannerStore.setState({ scheduleSync: { s1: 'failed' } }))
    expect(container.textContent).toBe('Couldn’t save — Retry')
    const button = container.querySelector('button')!
    await act(async () => button.click())
    expect(retry).toHaveBeenCalledWith('s1')
  })

  it('renders nothing for guest schedules', async () => {
    plannerStore.setState({ authed: false, scheduleSync: { s1: 'failed' } })
    await act(async () => root.render(<SyncStatus scheduleId="s1" />))
    expect(container.textContent).toBe('')
  })
})
