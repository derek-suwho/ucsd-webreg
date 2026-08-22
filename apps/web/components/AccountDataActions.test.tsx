// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plannerStore } from '@/lib/store'
import AccountDataActions from './AccountDataActions'

const mocks = vi.hoisted(() => ({
  fetchAccountExport: vi.fn(),
  deleteAccount: vi.fn(),
  downloadAccountExport: vi.fn(),
  signOut: vi.fn()
}))

vi.mock('@/lib/api-client', () => ({
  fetchAccountExport: mocks.fetchAccountExport,
  deleteAccount: mocks.deleteAccount
}))
vi.mock('@/lib/account-export', () => ({ downloadAccountExport: mocks.downloadAccountExport }))
vi.mock('next-auth/react', () => ({ signOut: mocks.signOut }))

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`missing button: ${label}`)
  return found
}

describe('AccountDataActions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    plannerStore.setState({ authed: true, scheduleSync: { s1: 'pending' } })
    mocks.fetchAccountExport.mockReset()
    mocks.deleteAccount.mockReset()
    mocks.downloadAccountExport.mockReset()
    mocks.signOut.mockReset()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('exports validated schedule data and reports export failures inline', async () => {
    const exported = { schemaVersion: 1, generatedAt: '2026-08-22T12:00:00.000Z', schedules: [] }
    mocks.fetchAccountExport.mockResolvedValueOnce(exported).mockRejectedValueOnce(new Error('offline'))
    await act(async () => root.render(<AccountDataActions />))

    await act(async () => button(container, 'Export schedules').click())
    expect(mocks.downloadAccountExport).toHaveBeenCalledWith(exported)

    await act(async () => button(container, 'Export schedules').click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not export schedules')
  })

  it('blocks rapid duplicate exports and resets the guard after failure', async () => {
    const exported = { schemaVersion: 1, generatedAt: '2026-08-22T12:00:00.000Z', schedules: [] }
    let rejectExport!: (reason: Error) => void
    const pending = new Promise((_, reject) => { rejectExport = reject })
    mocks.fetchAccountExport.mockReturnValueOnce(pending).mockResolvedValueOnce(exported)
    await act(async () => root.render(<AccountDataActions />))

    const exportButton = button(container, 'Export schedules')
    act(() => {
      exportButton.click()
      exportButton.click()
    })
    expect(mocks.fetchAccountExport).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectExport(new Error('offline'))
      await Promise.resolve()
    })
    await act(async () => button(container, 'Export schedules').click())
    expect(mocks.fetchAccountExport).toHaveBeenCalledTimes(2)
    expect(mocks.downloadAccountExport).toHaveBeenCalledWith(exported)
  })

  it('requires exact typed confirmation and blocks every dismiss path while deletion is pending', async () => {
    let finishDelete!: () => void
    mocks.deleteAccount.mockReturnValue(new Promise(resolve => { finishDelete = () => resolve({ ok: true }) }))
    mocks.signOut.mockResolvedValue(undefined)
    await act(async () => root.render(<AccountDataActions />))

    await act(async () => button(container, 'Delete account').click())
    const input = container.querySelector<HTMLInputElement>('input[name="confirmation"]')!
    const confirm = button(container, 'Permanently delete account')
    expect(document.activeElement).toBe(input)
    expect(confirm.disabled).toBe(true)

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'DELETE')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(confirm.disabled).toBe(false)

    act(() => confirm.click())
    await act(async () => Promise.resolve())
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-busy')).toBe('true')
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
    expect(close.disabled).toBe(true)
    act(() => {
      close.click()
      container.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => {
      finishDelete()
      await Promise.resolve()
    })
    expect(plannerStore.getState()).toMatchObject({ authed: false, scheduleSync: {} })
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: '/' })
  })

  it('keeps the dialog open and account state intact when deletion fails', async () => {
    mocks.deleteAccount.mockRejectedValue(new Error('server'))
    await act(async () => root.render(<AccountDataActions />))
    await act(async () => button(container, 'Delete account').click())
    const input = container.querySelector<HTMLInputElement>('input[name="confirmation"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'DELETE')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button(container, 'Permanently delete account').click())

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not delete account')
    expect(plannerStore.getState().authed).toBe(true)
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('restores focus to the delete opener after a normal cancellation', async () => {
    await act(async () => root.render(<AccountDataActions />))
    const opener = button(container, 'Delete account')
    opener.focus()
    await act(async () => opener.click())
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())

    expect(document.activeElement).toBe(button(container, 'Delete account'))
  })

  it('enters a terminal deleted state and retries only sign-out when sign-out fails', async () => {
    mocks.deleteAccount.mockResolvedValue({ ok: true })
    mocks.signOut.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    await act(async () => root.render(<AccountDataActions />))
    await act(async () => button(container, 'Delete account').click())
    const input = container.querySelector<HTMLInputElement>('input[name="confirmation"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'DELETE')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button(container, 'Permanently delete account').click())

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toMatch(/account deleted/i)
    expect(dialog.textContent).toMatch(/sign-out did not finish/i)
    expect(dialog.querySelector('input[name="confirmation"]')).toBeNull()
    expect([...dialog.querySelectorAll('button')].some(control => control.textContent === 'Permanently delete account')).toBe(false)
    expect(dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.disabled).toBe(true)

    act(() => {
      dialog.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => button(container, 'Retry sign out').click())
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('Delete account')
  })
})
