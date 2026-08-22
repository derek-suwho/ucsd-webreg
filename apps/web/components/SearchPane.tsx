'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { searchCourses } from '@webreg/search'
import { plannerStore } from '@/lib/store'
import CourseAccordion from './CourseAccordion'

const DEBOUNCE_MS = 150

export default function SearchPane() {
  const catalog = useStore(plannerStore, s => s.catalog)
  const index = useStore(plannerStore, s => s.index)
  const schedules = useStore(plannerStore, s => s.schedules)
  const activeScheduleId = useStore(plannerStore, s => s.activeScheduleId)

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const active = document.activeElement
    const documentHasFocus = !active || active === document.body || active === document.documentElement
    if (!documentHasFocus || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)').matches) return
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const results = useMemo(() => {
    if (!index || !debounced.trim()) return []
    return searchCourses(index, debounced)
  }, [index, debounced])

  const activeSectionIds = useMemo(
    () => schedules.find(s => s.id === activeScheduleId)?.sectionIds ?? [],
    [schedules, activeScheduleId]
  )

  const handlePlan = (courseId: string, family: string, sectionId: string) => {
    plannerStore.getState().addSelection(courseId, family, sectionId)
  }
  const handleRemove = (sectionId: string) => {
    plannerStore.getState().removeSection(sectionId)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1">
        <div className="flex items-center">
          <label htmlFor="wr-search-input" className="shrink-0 text-[14px] font-bold text-black">
            Search for Classes:
          </label>
          <input
            ref={inputRef}
            id="wr-search-input"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="(e.g., BILD, BILD 3 or computer 3 )"
            className="ml-2 h-[26px] w-[375px] min-w-0 rounded-[3px] border border-[#999999] bg-white px-2 text-[13px] text-ink placeholder:text-[#a8a8a8] focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-header-band"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto">
        {!catalog ? null : !debounced.trim() ? null : results.length === 0 ? (
          <p className="px-1 py-6 text-[13px] text-[#777777]">
            No results found, please verify your input and try another search.
          </p>
        ) : (
          <div className="border border-wr-grid-border">
            <p className="border-b border-wr-grid-border bg-gradient-to-b from-wr-th-from to-wr-th-to px-2 py-1 text-[13px] text-black">
              {results.length} course(s) found
            </p>
            {results.map(courseId => (
              <CourseAccordion
                key={courseId}
                catalog={catalog}
                courseId={courseId}
                activeSectionIds={activeSectionIds}
                onPlan={handlePlan}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
