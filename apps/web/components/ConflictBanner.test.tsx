// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CatalogData } from '@webreg/catalog'
import { plannerStore } from '@/lib/store'
import { PLANNER_CATALOG } from './__tests__/planner-catalog'
import ConflictBanner from './ConflictBanner'

const CATALOG: CatalogData = {
  ...PLANNER_CATALOG,
  courses: {
    ...PLANNER_CATALOG.courses,
    C2: {
      id: 'C2', subject: 'MATH', number: '20A', title: 'Calculus',
      unitsFrom: 4, unitsTo: 4, unitsInc: 0, sectionIds: ['B1']
    }
  },
  sections: {
    ...PLANNER_CATALOG.sections,
    B1: {
      id: 'B1', courseId: 'C2', code: 'B01', family: 'LE', regNum: 201,
      instructor: null, cap: 30, avail: 5, wait: 0, cancelled: false,
      meetings: [{ type: 'LE', days: 'M', start: 620, end: 680, bldg: null, room: null }],
      exams: [{ type: 'XX', date: '2026-12-14', start: 600, end: 720 }]
    }
  }
}

describe('ConflictBanner trust copy', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    plannerStore.setState({ catalog: CATALOG })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('identifies exact planned sections and conflict timing without claiming enrollment actions', async () => {
    await act(async () => root.render(<ConflictBanner conflicts={[
      { a: 'A1', b: 'B1', kind: 'meeting', day: 'M' },
      { a: 'A1', b: 'B1', kind: 'exam', date: '2026-12-14' }
    ]} />))

    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('CSE 100 A01 conflicts with MATH 20A B01 on M')
    expect(alert.textContent).toContain('CSE 100 A01 exam overlaps with MATH 20A B01 on 2026-12-14')
    expect(alert.textContent).toMatch(/planning-only/i)
    expect(alert.textContent).toMatch(/cannot enroll or drop/i)
    expect(alert.textContent).not.toMatch(/add request|has processed|dropping|MATH 20A Final/i)
  })
})
