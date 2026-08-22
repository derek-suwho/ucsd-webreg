import { isIP } from 'node:net'

export function getClientIp(request: Request, trustedProxyHops: number): string | null {
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops <= 0) {
    return null
  }

  const forwardedFor = request.headers.get('x-forwarded-for')
  if (!forwardedFor) {
    return null
  }

  const addresses = forwardedFor.split(',').map(value => value.trim())
  if (addresses.some(address => !address || isIP(address) === 0)) {
    return null
  }

  return addresses.at(-trustedProxyHops) ?? null
}
