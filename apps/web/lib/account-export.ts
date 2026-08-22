import type { AccountExport } from './api-client'

export function downloadAccountExport(data: AccountExport): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = `course-planner-schedules-${data.generatedAt.slice(0, 10)}.json`
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
}
