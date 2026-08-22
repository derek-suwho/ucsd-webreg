const PERMISSIONS_POLICY =
  'camera=(), geolocation=(), microphone=(), payment=(), usb=()'

type SecurityHeaderOptions = {
  production: boolean
  enableHsts: boolean
}

export function buildContentSecurityPolicy(
  nonce: string,
  production: boolean
): string {
  const scriptSources = [
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(!production ? ["'unsafe-eval'"] : [])
  ]

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(production ? ['upgrade-insecure-requests'] : [])
  ]

  return directives.join('; ')
}

export function buildSecurityHeaders(
  nonce: string,
  options: SecurityHeaderOptions
): Headers {
  const headers = new Headers({
    'Content-Security-Policy': buildContentSecurityPolicy(nonce, options.production),
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  })

  if (options.production && options.enableHsts) {
    headers.set('Strict-Transport-Security', 'max-age=31536000')
  }

  return headers
}
