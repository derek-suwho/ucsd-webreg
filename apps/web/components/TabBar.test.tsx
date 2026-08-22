// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar, { type ScheduleTab } from './TabBar'

describe('TabBar keyboard navigation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it.each([
    ['ArrowRight', 'calendar'],
    ['ArrowLeft', 'finals'],
    ['Home', 'list'],
    ['End', 'finals']
  ] as const)('%s focuses and activates %s', async (key, expected) => {
    const onChange = vi.fn<(id: ScheduleTab) => void>()
    await act(async () => root.render(<TabBar active="list" onChange={onChange} />))
    const list = container.querySelector<HTMLButtonElement>('#tab-list')!
    list.focus()

    await act(async () => list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

    expect(onChange).toHaveBeenCalledWith(expected)
    expect(document.activeElement).toBe(container.querySelector(`#tab-${expected}`))
  })

  it('uses roving tab stops, linked panels, and 44px hit targets', async () => {
    await act(async () => root.render(<TabBar active="calendar" onChange={() => {}} />))
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]

    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, 0, -1])
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(tabs.map(tab => tab.getAttribute('aria-controls'))).toEqual(['tabpanel-list', 'tabpanel-calendar', 'tabpanel-finals'])
    expect(tabs.every(tab => tab.className.includes('min-h-11'))).toBe(true)
  })
})
