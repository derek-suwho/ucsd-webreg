import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PrivacyPage from './privacy/page'
import TermsPage from './terms/page'

describe('legal pages', () => {
  it('accurately describes stored account, browser, cookie, infrastructure, and deletion data', () => {
    const html = renderToStaticMarkup(<PrivacyPage />)

    expect(html).toContain('Privacy')
    expect(html).toMatch(/Google/i)
    expect(html).toMatch(/email/i)
    expect(html).toMatch(/schedule/i)
    expect(html).toMatch(/browser/i)
    expect(html).toMatch(/cookie/i)
    expect(html).toMatch(/PostgreSQL/i)
    expect(html).toMatch(/Redis/i)
    expect(html).toMatch(/delete/i)
    expect(html).not.toMatch(/deleted from every backup immediately/i)
  })

  it('states the planning-only, data-freshness, and non-endorsement boundaries', () => {
    const html = renderToStaticMarkup(<TermsPage />)

    expect(html).toContain('Terms')
    expect(html).toMatch(/cannot enroll/i)
    expect(html).toMatch(/demo/i)
    expect(html).toMatch(/when.*labeled.*demo.*fixture/i)
    expect(html).toMatch(/catalog status.*generated timestamp/i)
    expect(html).toMatch(/verify.*official/i)
    expect(html).toMatch(/not affiliated|not endorsed/i)
    expect(html).not.toMatch(/live seat availability/i)
    expect(html).not.toMatch(/current catalog is demo data/i)
  })
})
