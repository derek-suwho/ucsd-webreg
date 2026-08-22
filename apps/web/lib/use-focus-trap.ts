import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Traps Tab focus inside a modal dialog and calls onCancel on Escape.
 * Moves focus into the dialog and captures the previously-focused element when `active` becomes
 * true, and restores that element when `active` becomes false (or on unmount). `active` defaults
 * to true for dialogs that are only ever mounted while open; dialogs that stay mounted and toggle
 * visibility (e.g. via internal state) must pass their own open/closed flag so setup/teardown track
 * that instead of the component's mount/unmount, which may never happen while the page is up.
 */
export function useFocusTrap(dialogRef: RefObject<HTMLElement | null>, onCancel: () => void, active: boolean = true): void {
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    if (!active) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    focusable?.[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeEl = document.activeElement

      if (e.shiftKey) {
        if (activeEl === first || !dialogRef.current.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (activeEl === last || !dialogRef.current.contains(activeEl)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [dialogRef, active])
}
