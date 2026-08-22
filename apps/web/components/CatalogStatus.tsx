'use client'

import type { CatalogProvenance } from '@webreg/catalog'
import type { LoadStatus } from '@/lib/store'

type CatalogStatusProps = {
  status: LoadStatus
  error: string | null
  provenance: CatalogProvenance | null
  generatedAt: string | null
  onRetry: () => void
}

function generatedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(date)
}

export default function CatalogStatus({ status, error, provenance, generatedAt, onRetry }: CatalogStatusProps) {
  if (status === 'loading') {
    return <p role="status" className="mt-1 text-[12px] text-[#555555]">Loading catalog…</p>
  }

  if (status === 'error') {
    return (
      <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-wr-ui-error-text">
        <span>{error ?? 'Could not load catalog. Try again.'}</span>
        <button
          type="button"
          onClick={onRetry}
          className="font-bold text-wr-link hover:underline active:translate-y-px focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-header-band"
        >
          Retry catalog
        </button>
      </p>
    )
  }

  if (status !== 'ready' || !provenance || !generatedAt) return null

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-[#555555]">
      <span className="font-bold text-[#7a4b00]">
        {provenance.mode === 'demo' ? 'Demo catalog — not live seat data' : 'Catalog snapshot'}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Generated <time dateTime={generatedAt}>{generatedLabel(generatedAt)} UTC</time>
      </span>
    </p>
  )
}
