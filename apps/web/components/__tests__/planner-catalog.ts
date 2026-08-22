import type { CatalogData } from '@webreg/catalog'

export const PLANNER_CATALOG: CatalogData = {
  termId: 'FA26',
  version: 1,
  generatedAt: '2026-08-21T12:00:00.000Z',
  provenance: {
    sourceKind: 'fixture',
    mode: 'demo',
    sourceGeneratedAt: '2026-08-20T12:00:00.000Z'
  },
  courses: {
    C1: {
      id: 'C1',
      subject: 'CSE',
      number: '100',
      title: 'Accessible Planning',
      unitsFrom: 4,
      unitsTo: 4,
      unitsInc: 0,
      sectionIds: ['A1', 'A2', 'TBA']
    }
  },
  sections: {
    A1: {
      id: 'A1',
      courseId: 'C1',
      code: 'A01',
      family: 'DI',
      regNum: 101,
      instructor: 'Ada Lovelace',
      cap: 30,
      avail: 4,
      wait: 0,
      cancelled: false,
      meetings: [{ type: 'DI', days: 'MW', start: 600, end: 650, bldg: 'CENTR', room: '101' }],
      exams: [{ type: 'FI', date: '2026-12-14', start: 540, end: 660 }]
    },
    A2: {
      id: 'A2',
      courseId: 'C1',
      code: 'A02',
      family: 'DI',
      regNum: 102,
      instructor: 'Grace Hopper',
      cap: 30,
      avail: 8,
      wait: 0,
      cancelled: false,
      meetings: [{ type: 'DI', days: 'TuTh', start: 720, end: 770, bldg: 'CENTR', room: '102' }],
      exams: []
    },
    TBA: {
      id: 'TBA',
      courseId: 'C1',
      code: 'B01',
      family: 'LA',
      regNum: 103,
      instructor: null,
      cap: 20,
      avail: 2,
      wait: 0,
      cancelled: false,
      meetings: [{ type: 'LA', days: null, start: null, end: null, bldg: null, room: null }],
      exams: []
    }
  }
}
