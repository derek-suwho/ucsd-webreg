import type { CatalogData, CatalogSection } from '@webreg/catalog'

export function familySections(catalog: CatalogData, courseId: string, family: string): CatalogSection[] {
  const course = catalog.courses[courseId]
  if (!course) return []
  return course.sectionIds
    .map(id => catalog.sections[id])
    .filter((s): s is CatalogSection => !!s && s.family === family)
    .sort((a, b) => a.code.localeCompare(b.code))
}

export function swapWithinFamily(sectionIds: string[], fromId: string, toId: string): string[] {
  const idx = sectionIds.indexOf(fromId)
  if (idx === -1) return [...sectionIds]
  const result = [...sectionIds]
  result[idx] = toId
  return result
}

export function planSelection(
  catalog: CatalogData,
  courseId: string,
  family: string,
  chosen: string
): string[] {
  const section = catalog.sections[chosen]
  if (!section || section.courseId !== courseId || section.family !== family) {
    throw new Error(`section "${chosen}" is not a member of course "${courseId}" family "${family}"`)
  }
  return [chosen]
}
