import type { CatalogData, CatalogCourse } from '@webreg/catalog'

export type SearchIndex = {
  exactMap: Map<string, string>
  subjects: string[]
  subjectCourses: Map<string, string[]>
  regNumMap: Map<number, string>
  titleEntries: { courseId: string; tokens: string[] }[]
  instructorEntries: { courseId: string; tokens: string[] }[]
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function parseNumber(num: string): [number, string] {
  const m = num.match(/^(\d+)(.*)$/)
  if (!m) return [0, num.toLowerCase()]
  return [parseInt(m[1], 10), m[2].toLowerCase()]
}

function compareCourseNumber(a: string, b: string): number {
  const [an, as] = parseNumber(a)
  const [bn, bs] = parseNumber(b)
  if (an !== bn) return an - bn
  return as < bs ? -1 : as > bs ? 1 : 0
}

export function buildIndex(catalog: CatalogData): SearchIndex {
  const exactMap = new Map<string, string>()
  const subjectCoursesRaw = new Map<string, CatalogCourse[]>()
  const regNumMap = new Map<number, string>()
  const titleEntries: { courseId: string; tokens: string[] }[] = []
  const instructorEntries: { courseId: string; tokens: string[] }[] = []

  const courses = Object.values(catalog.courses).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const course of courses) {
    const subjectLower = course.subject.toLowerCase()
    const numberLower = course.number.toLowerCase()
    exactMap.set(subjectLower + numberLower, course.id)

    if (!subjectCoursesRaw.has(subjectLower)) subjectCoursesRaw.set(subjectLower, [])
    subjectCoursesRaw.get(subjectLower)!.push(course)

    titleEntries.push({ courseId: course.id, tokens: tokenize(course.title) })

    const instructors = new Set<string>()
    for (const sectionId of course.sectionIds) {
      const section = catalog.sections[sectionId]
      if (!section) continue
      if (section.regNum !== null) regNumMap.set(section.regNum, course.id)
      if (section.instructor) instructors.add(section.instructor)
    }
    const instructorTokens = Array.from(instructors).flatMap(tokenize)
    if (instructorTokens.length > 0) instructorEntries.push({ courseId: course.id, tokens: instructorTokens })
  }

  const subjectCourses = new Map<string, string[]>()
  const subjects: string[] = []
  for (const [subject, list] of subjectCoursesRaw) {
    subjects.push(subject)
    subjectCourses.set(
      subject,
      list.slice().sort((a, b) => compareCourseNumber(a.number, b.number)).map(c => c.id)
    )
  }
  subjects.sort()

  return { exactMap, subjects, subjectCourses, regNumMap, titleEntries, instructorEntries }
}

export function searchCourses(index: SearchIndex, query: string, limit = 50): string[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []

  const results: string[] = []
  const seen = new Set<string>()
  const add = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    results.push(id)
  }

  const compact = trimmed.replace(/\s+/g, '')

  // Tier 1: exact "SUBJ NUM"
  const exactMatch = compact.match(/^([a-z]+)(\d[a-z0-9]*)$/)
  if (exactMatch) {
    const courseId = index.exactMap.get(exactMatch[1] + exactMatch[2])
    if (courseId) add(courseId)
  }

  // Tier 2: subject-code prefix
  if (/^[a-z]+$/.test(compact)) {
    for (const subject of index.subjects) {
      if (subject.startsWith(compact)) {
        for (const courseId of index.subjectCourses.get(subject) ?? []) add(courseId)
      }
    }
  }

  // Tier 3: 6-digit registration number
  if (/^\d{6}$/.test(compact)) {
    const courseId = index.regNumMap.get(parseInt(compact, 10))
    if (courseId) add(courseId)
  }

  const queryTokens = trimmed.split(/\s+/).filter(Boolean)
  if (queryTokens.length > 0) {
    // Tier 4: title word prefix (every query token prefix-matches some title token)
    for (const entry of index.titleEntries) {
      if (queryTokens.every(qt => entry.tokens.some(t => t.startsWith(qt)))) {
        add(entry.courseId)
      }
    }

    // Tier 5: instructor name prefix (any query token prefix-matches any instructor token)
    for (const entry of index.instructorEntries) {
      if (queryTokens.some(qt => entry.tokens.some(t => t.startsWith(qt)))) {
        add(entry.courseId)
      }
    }
  }

  return results.slice(0, limit)
}
