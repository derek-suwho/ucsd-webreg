// @vitest-environment jsdom

import { Suspense, act, startTransition, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFocusTrap } from './use-focus-trap'

const suspended = new Promise<void>(() => {})
const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }

function Harness({ onCancel, suspend = false }: { onCancel: () => void, suspend?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, onCancel)

  if (suspend) throw suspended

  return <div ref={dialogRef}><button type="button">Action</button></div>
}

describe('useFocusTrap', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps the committed cancel callback during a suspended transition', async () => {
    const committedCancel = vi.fn()
    const suspendedCancel = vi.fn()

    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <Harness onCancel={committedCancel} />
        </Suspense>
      )
    })

    await act(async () => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<div>Loading</div>}>
            <Harness onCancel={suspendedCancel} suspend />
          </Suspense>
        )
      })
      await Promise.resolve()
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(committedCancel).toHaveBeenCalledOnce()
    expect(suspendedCancel).not.toHaveBeenCalled()
  })

  it('uses a new cancel callback after its rerender commits', async () => {
    const initialCancel = vi.fn()
    const committedCancel = vi.fn()

    await act(async () => {
      root.render(<Harness onCancel={initialCancel} />)
    })
    await act(async () => {
      root.render(<Harness onCancel={committedCancel} />)
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(initialCancel).not.toHaveBeenCalled()
    expect(committedCancel).toHaveBeenCalledOnce()
  })
})
