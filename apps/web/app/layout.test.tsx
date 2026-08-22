// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/AuthButton', () => ({
  default: () => <button type="button">Account</button>
}))

import RootLayout, { metadata } from './layout'

describe('planner shell identity', () => {
  it('renders an independent identity, skip target, and repeated cannot-enroll notice', () => {
    document.documentElement.innerHTML = renderToStaticMarkup(
      <RootLayout><p>Planner body</p></RootLayout>
    )

    const first = document.body.firstElementChild
    expect(first?.tagName).toBe('A')
    expect(first?.getAttribute('href')).toBe('#main-content')
    expect(first?.textContent).toBe('Skip to planner')
    expect(document.querySelector('main#main-content')?.textContent).toContain('Planner body')

    const notice = 'Unofficial planning tool — cannot enroll'
    expect(document.querySelector('header')?.textContent).toContain('Course Planner')
    expect(document.querySelector('header')?.textContent).toContain('UC San Diego')
    expect(document.querySelector('header')?.textContent).toContain(notice)
    expect(document.querySelector('footer')?.textContent).toContain(notice)
    expect(document.body.textContent?.match(new RegExp(notice, 'g'))).toHaveLength(2)
    expect(document.body.textContent).not.toContain('UCSD WebReg')
    expect(document.querySelector('footer')?.textContent).not.toMatch(/scraped|MIT License/i)
    const legal = document.querySelector('footer nav[aria-label="Legal"]')!
    expect([...legal.querySelectorAll('a')].map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Privacy', '/privacy'],
      ['Terms', '/terms']
    ])
    expect([...legal.querySelectorAll('a')].every(link => (
      link.className.includes('min-h-11') &&
      link.className.includes('min-w-11') &&
      link.className.includes('justify-center')
    ))).toBe(true)
    expect(metadata.title).toBe('Course Planner')
  })
})
