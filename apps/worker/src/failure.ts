import { SnapshotLimitError } from '@webreg/catalog'

export const WORKER_FAILURE_CATEGORIES = [
  'department_list_failed',
  'department_sync_failed',
  'catalog_lock_skipped',
  'catalog_write_failed',
  'fixture_ownership_failed',
  'snapshot_build_failed',
  'snapshot_limit_exceeded',
  'worker_operation_failed'
] as const

export type WorkerFailureCategory = typeof WORKER_FAILURE_CATEGORIES[number]

export function classifyWorkerError(error: unknown): WorkerFailureCategory {
  if (error instanceof SnapshotLimitError) return 'snapshot_limit_exceeded'
  if (typeof error === 'object' && error !== null && 'category' in error) {
    const category = (error as { category?: unknown }).category
    if (WORKER_FAILURE_CATEGORIES.includes(category as WorkerFailureCategory)) {
      return category as WorkerFailureCategory
    }
  }
  return 'worker_operation_failed'
}
