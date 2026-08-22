import { describe, expect, it } from 'vitest'
import { getClientIp } from './client-ip'

function requestWithForwardedFor(value: string) {
  return new Request('https://example.test/api', {
    headers: { 'x-forwarded-for': value }
  })
}

describe('getClientIp', () => {
  it('selects trusted proxy hops from right to left', () => {
    const request = requestWithForwardedFor('2001:db8::1, 198.51.100.8, 192.0.2.4')

    expect(getClientIp(request, 1)).toBe('192.0.2.4')
    expect(getClientIp(request, 2)).toBe('198.51.100.8')
    expect(getClientIp(request, 3)).toBe('2001:db8::1')
  })

  it('rejects the entire forwarding chain when any entry is malformed', () => {
    expect(getClientIp(requestWithForwardedFor('198.51.100.8, attacker.example'), 1)).toBeNull()
    expect(getClientIp(requestWithForwardedFor('198.51.100.8,,192.0.2.4'), 1)).toBeNull()
    expect(getClientIp(requestWithForwardedFor('198.51.100.8:443'), 1)).toBeNull()
  })

  it('does not trust forwarding headers when hop count is zero', () => {
    expect(getClientIp(requestWithForwardedFor('198.51.100.8'), 0)).toBeNull()
  })

  it('rejects invalid hop counts and chains shorter than the configured hops', () => {
    const request = requestWithForwardedFor('198.51.100.8')

    expect(getClientIp(request, -1)).toBeNull()
    expect(getClientIp(request, 1.5)).toBeNull()
    expect(getClientIp(request, 2)).toBeNull()
  })
})
