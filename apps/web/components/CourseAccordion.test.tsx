// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogData } from '@webreg/catalog'
import CourseAccordion from './CourseAccordion'

const CATALOG: CatalogData = {
  termId: 'FA26',
  version: 1,
  generatedAt: '2026-08-21T12:00:00.000Z',
  provenance: { sourceKind: 'fixture', mode: 'demo', sourceGeneratedAt: '2026-08-20T12:00:00.000Z' },
  courses: {
    C1: {
      id: 'C1', subject: 'CSE', number: '100', title: 'Planner Semantics',
      unitsFrom: 4, unitsTo: 4, unitsInc: 0, sectionIds: ['OPEN', 'FULL', 'UNLIM', 'CANCELLED']
    }
  },
  sections: {
    OPEN: { id: 'OPEN', courseId: 'C1', code: 'A00', family: 'A', regNum: 1, instructor: null, cap: 10, avail: 2, wait: 0, cancelled: false, meetings: [], exams: [] },
    FULL: { id: 'FULL', courseId: 'C1', code: 'B00', family: 'B', regNum: 2, instructor: null, cap: 10, avail: 0, wait: 3, cancelled: false, meetings: [], exams: [] },
    UNLIM: { id: 'UNLIM', courseId: 'C1', code: 'C00', family: 'C', regNum: 3, instructor: null, cap: null, avail: null, wait: null, cancelled: false, meetings: [], exams: [] },
    CANCELLED: { id: 'CANCELLED', courseId: 'C1', code: 'D00', family: 'D', regNum: 4, instructor: null, cap: 10, avail: 0, wait: 0, cancelled: true, meetings: [], exams: [] }
  }
}

describe('CourseAccordion seat semantics', () => {
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

  it('distinguishes all seat states and keeps a full noncancelled section plannable with warning', async () => {
    const onPlan = vi.fn()
    await act(async () => root.render(
      <CourseAccordion catalog={CATALOG} courseId="C1" activeSectionIds={[]} onPlan={onPlan} onRemove={() => {}} />
    ))
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())

    expect(container.textContent).toContain('Open 2/10')
    expect(container.textContent).toContain('FULL WL 3')
    expect(container.textContent).toContain('Unlimited')
    expect(container.textContent).toContain('Cancelled')
    expect(container.textContent).toContain('Full sections can still be planned. Planning does not reserve a seat.')

    const fullFamilyRow = [...container.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('Section B'))
    await act(async () => fullFamilyRow!.querySelector<HTMLButtonElement>('button')!.click())
    expect(onPlan).toHaveBeenCalledWith('C1', 'B', 'FULL')

    const cancelledFamilyRow = [...container.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('Section D'))
    expect(cancelledFamilyRow?.querySelector('button')).toBeNull()
  })

  it('allows an all-cancelled course to expand for inspection without planning controls', async () => {
    const cancelledCatalog: CatalogData = {
      ...CATALOG,
      courses: { C1: { ...CATALOG.courses.C1, sectionIds: ['CANCELLED'] } }
    }
    await act(async () => root.render(
      <CourseAccordion catalog={cancelledCatalog} courseId="C1" activeSectionIds={[]} onPlan={() => {}} onRemove={() => {}} />
    ))

    const disclosure = container.querySelector<HTMLButtonElement>('button[aria-controls]')
    expect(disclosure?.disabled).toBe(false)
    await act(async () => disclosure!.click())
    expect(document.getElementById(disclosure!.getAttribute('aria-controls')!)?.hidden).toBe(false)
    expect(container.textContent).toContain('D00')
  })
})
