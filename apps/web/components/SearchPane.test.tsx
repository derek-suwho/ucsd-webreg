// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plannerStore } from '@/lib/store'
import SearchPane from './SearchPane'

function media(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '(min-width: 768px) and (hover: hover) and (pointer: fine)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }
}

describe('SearchPane focus', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    plannerStore.setState({ catalog: null, index: null, schedules: [], activeScheduleId: null })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('focuses search only for a fine pointer when focus is otherwise on the document', async () => {
    const matchMedia = vi.fn().mockReturnValue(media(true))
    vi.stubGlobal('matchMedia', matchMedia)
    await act(async () => root.render(<SearchPane />))
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 768px) and (hover: hover) and (pointer: fine)')
    expect(document.activeElement).toBe(container.querySelector('input[type="search"]'))
    expect(container.textContent).not.toContain('Loading catalog')
  })

  it('never steals existing focus and does not summon focus for a coarse pointer', async () => {
    const existing = document.createElement('button')
    document.body.append(existing)
    existing.focus()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media(true)))
    await act(async () => root.render(<SearchPane />))
    expect(document.activeElement).toBe(existing)

    await act(async () => root.unmount())
    root = createRoot(container)
    existing.remove()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media(false)))
    await act(async () => root.render(<SearchPane />))
    expect(document.activeElement).not.toBe(container.querySelector('input[type="search"]'))
  })
})
