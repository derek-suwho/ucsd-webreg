// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plannerStore } from '@/lib/store'
import ScheduleSwitcher from './ScheduleSwitcher'

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === name)
  if (!match) throw new Error(`Missing button: ${name}`)
  return match
}

function enterText(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setValue) throw new Error('Missing native input value setter')
  setValue.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ScheduleSwitcher', () => {
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
      authed: false,
      schedules: [
        { id: 's1', termId: 'FA26', name: 'Primary', sectionIds: [] },
        { id: 's2', termId: 'FA26', name: 'Alternate', sectionIds: [] }
      ],
      activeScheduleId: 's1',
      lastError: null
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('uses a labeled native select without composite-listbox roles or a phantom schedule', async () => {
    const setActive = vi.spyOn(plannerStore.getState(), 'setActive')
    await act(async () => root.render(<ScheduleSwitcher />))

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Active schedule"]')
    expect(select?.value).toBe('s1')
    expect([...select!.options].map(option => [option.value, option.text])).toEqual([
      ['s1', 'Primary'],
      ['s2', 'Alternate']
    ])
    expect(container.querySelector('[role="listbox"], [role="option"]')).toBeNull()

    select!.value = 's2'
    await act(async () => select!.dispatchEvent(new Event('change', { bubbles: true })))
    expect(setActive).toHaveBeenCalledWith('s2')

    await act(async () => plannerStore.setState({ schedules: [], activeScheduleId: null }))
    expect(container.textContent).not.toContain('My Schedule')
    expect(select?.value).toBe('')
    expect(select?.disabled).toBe(true)
  })

  it('keeps every schedule action visible, adjacent, and at least 44px tall', async () => {
    await act(async () => root.render(<ScheduleSwitcher />))

    for (const name of ['New', 'Copy', 'Rename', 'Delete']) {
      const action = button(container, name)
      expect(action.className).toContain('min-h-11')
      expect(action.closest('[data-schedule-controls]')).not.toBeNull()
    }

    await act(async () => plannerStore.setState({ schedules: [], activeScheduleId: null }))
    expect(button(container, 'New').disabled).toBe(false)
    expect(button(container, 'Copy').disabled).toBe(true)
    expect(button(container, 'Rename').disabled).toBe(true)
    expect(button(container, 'Delete').disabled).toBe(true)
  })

  it('traps focus in a modal form, cancels with Escape, and restores trigger focus', async () => {
    await act(async () => root.render(<ScheduleSwitcher />))
    const trigger = button(container, 'Rename')
    trigger.focus()
    await act(async () => trigger.click())

    const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!
    const input = dialog.querySelector<HTMLInputElement>('input[name="schedule-name"]')!
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(input.value).toBe('Primary')
    expect(document.activeElement).toBe(input)

    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
    focusable.at(-1)!.focus()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.activeElement).toBe(focusable[0])

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('submits against the captured schedule and names destructive confirmation', async () => {
    const rename = vi.spyOn(plannerStore.getState(), 'renameSchedule').mockResolvedValue()
    const remove = vi.spyOn(plannerStore.getState(), 'deleteSchedule').mockResolvedValue()
    await act(async () => root.render(<ScheduleSwitcher />))

    await act(async () => button(container, 'Rename').click())
    await act(async () => plannerStore.setState({ activeScheduleId: 's2' }))
    const input = container.querySelector<HTMLInputElement>('input[name="schedule-name"]')!
    await act(async () => enterText(input, 'Captured rename'))
    await act(async () => input.form!.requestSubmit())
    expect(rename).toHaveBeenCalledWith('s1', 'Captured rename')

    await act(async () => button(container, 'Delete').click())
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('Delete “Alternate”?')
    await act(async () => button(dialog, 'Delete').click())
    expect(remove).toHaveBeenCalledWith('s2')
  })

  it('guards duplicate submissions and retains a failed dialog for retry', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const create = vi.spyOn(plannerStore.getState(), 'createSchedule').mockImplementation(async () => {
      await pending
      plannerStore.setState({ lastError: 'Failed to create schedule' })
    })
    await act(async () => root.render(<ScheduleSwitcher />))
    await act(async () => button(container, 'New').click())

    const input = container.querySelector<HTMLInputElement>('input[name="schedule-name"]')!
    await act(async () => enterText(input, 'New plan'))
    const form = input.form!
    act(() => {
      form.requestSubmit()
      form.requestSubmit()
    })
    await act(async () => Promise.resolve())

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(create).toHaveBeenCalledTimes(1)
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect([...dialog.querySelectorAll<HTMLButtonElement>('button')].every(control => control.disabled)).toBe(true)

    await act(async () => {
      finish()
      await pending
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Failed to create schedule')
  })
})
