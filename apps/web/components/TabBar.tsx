'use client'

import { useRef } from 'react'

export type ScheduleTab = 'list' | 'calendar' | 'finals'

const TABS: { id: ScheduleTab; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'finals', label: 'Finals' }
]

export function tabPanelId(id: ScheduleTab): string {
  return `tabpanel-${id}`
}

type TabBarProps = {
  active: ScheduleTab
  onChange: (id: ScheduleTab) => void
}

export default function TabBar({ active, onChange }: TabBarProps) {
  const buttonRefs = useRef<Partial<Record<ScheduleTab, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return

    e.preventDefault()
    const next = TABS[nextIndex]
    onChange(next.id)
    buttonRefs.current[next.id]?.focus()
  }

  return (
    <div role="tablist" aria-label="Schedule view" className="flex items-end gap-[3px]">
      {TABS.map((tab, i) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={el => {
              buttonRefs.current[tab.id] = el
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={tabPanelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={e => onKeyDown(e, i)}
            className={`relative flex min-h-11 min-w-11 items-center justify-center rounded-t-md px-[22px] text-[14px] font-bold transition-[background-color,color,transform] focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-[-2px] focus-visible:outline-wr-header-band ${
              selected
                ? 'z-10 bg-white text-wr-orange'
                : 'border-x border-t border-wr-ui-default-border bg-linear-to-b from-wr-tab-from to-wr-tab-to text-wr-tab-text hover:from-wr-ui-hover-bg-from hover:to-wr-ui-hover-bg-to hover:text-wr-ui-hover-text active:scale-[0.97]'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
