// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CatalogStatus from './CatalogStatus'

describe('CatalogStatus', () => {
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

  it('labels demo provenance exactly and exposes the generated timestamp semantically', async () => {
    await act(async () => root.render(
      <CatalogStatus
        status="ready"
        error={null}
        provenance={{ sourceKind: 'fixture', mode: 'demo', sourceGeneratedAt: '2026-08-20T12:00:00.000Z' }}
        generatedAt="2026-08-21T15:30:00.000Z"
        onRetry={() => {}}
      />
    ))

    expect(container.textContent).toContain('Demo catalog — not live seat data')
    expect(container.querySelector('time')?.dateTime).toBe('2026-08-21T15:30:00.000Z')
    expect(container.textContent).not.toMatch(/available now|stale|ago/i)
  })

  it('renders honest loading and retryable error states', async () => {
    const retry = vi.fn()
    await act(async () => root.render(
      <CatalogStatus status="loading" error={null} provenance={null} generatedAt={null} onRetry={retry} />
    ))
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading catalog')

    await act(async () => root.render(
      <CatalogStatus
        status="error"
        error="Could not load catalog. Try again."
        provenance={null}
        generatedAt={null}
        onRetry={retry}
      />
    ))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not load catalog. Try again.')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
