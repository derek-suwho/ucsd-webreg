// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLANNER_CATALOG } from './__tests__/planner-catalog'
import ConfirmPlanDialog from './ConfirmPlanDialog'

describe('ConfirmPlanDialog', () => {
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

  it('focuses the first choice and exposes 44px dialog controls and option rows', async () => {
    const onConfirm = vi.fn()
    await act(async () => root.render(
      <ConfirmPlanDialog
        course={PLANNER_CATALOG.courses.C1}
        family="DI"
        sections={[PLANNER_CATALOG.sections.A1, PLANNER_CATALOG.sections.A2]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    ))

    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(document.activeElement).toBe(radios[0])
    expect([...container.querySelectorAll('fieldset label')].every(label => label.className.includes('min-h-11'))).toBe(true)
    expect(container.querySelector('button[aria-label="Close"]')?.className).toContain('min-h-11')
    const actions = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(button => ['Cancel', 'Confirm'].includes(button.textContent?.trim() ?? ''))
    expect(actions.every(button => button.className.includes('min-h-11'))).toBe(true)

    await act(async () => radios[1].click())
    await act(async () => actions.find(button => button.textContent === 'Confirm')!.click())
    expect(onConfirm).toHaveBeenCalledWith('A2')
  })
})
