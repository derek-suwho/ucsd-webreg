import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders
} from './lib/security-headers'

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const production = process.env.NODE_ENV === 'production'
  const policy = buildContentSecurityPolicy(nonce, production)
  const requestHeaders = new Headers(request.headers)

  requestHeaders.set('Content-Security-Policy', policy)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  })

  buildSecurityHeaders(nonce, {
    production,
    enableHsts: process.env.ENABLE_HSTS === 'true'
  }).forEach((value, name) => {
    response.headers.set(name, value)
  })

  return response
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)'
}
