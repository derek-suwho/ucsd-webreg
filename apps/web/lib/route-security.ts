import { getClientIp } from './client-ip'
import { loadWebEnv } from '@webreg/config'
import {
  checkRateLimit,
  rateLimitResponse,
  type RateLimitStore
} from './rate-limit'

export interface RouteRateLimit {
  bucket: string
  limit: number
  windowSeconds: number
}

interface RouteRateLimitDependencies {
  store?: RateLimitStore
  trustedProxyHops?: number
  production?: boolean
}

export interface MutationOriginDependencies {
  appOrigin?: string
  production?: boolean
}

export const RATE_LIMITS = {
  terms: { bucket: 'terms', limit: 120, windowSeconds: 60 },
  seats: { bucket: 'seats', limit: 120, windowSeconds: 60 },
  catalog: { bucket: 'catalog', limit: 30, windowSeconds: 60 },
  health: { bucket: 'health', limit: 20, windowSeconds: 60 },
  auth: { bucket: 'auth', limit: 10, windowSeconds: 60 },
  scheduleMutation: { bucket: 'schedule-mutation', limit: 30, windowSeconds: 60 },
  accountExport: { bucket: 'account-export', limit: 5, windowSeconds: 60 },
  accountDelete: { bucket: 'account-delete', limit: 3, windowSeconds: 60 * 60 }
} as const satisfies Record<string, RouteRateLimit>

function unavailableResponse() {
  return Response.json({ error: 'service unavailable' }, { status: 503 })
}

function forbiddenResponse() {
  return Response.json({ error: 'forbidden' }, { status: 403 })
}

export function enforceMutationOrigin(
  request: Request,
  dependencies: MutationOriginDependencies = {}
): Response | null {
  const production = dependencies.production ?? process.env.NODE_ENV === 'production'
  if (!production) return null

  const appOrigin = dependencies.appOrigin ?? loadWebEnv().APP_ORIGIN
  const origin = request.headers.get('origin')
  if (!appOrigin || !origin) return forbiddenResponse()

  try {
    return new URL(origin).origin === new URL(appOrigin).origin
      ? null
      : forbiddenResponse()
  } catch {
    return forbiddenResponse()
  }
}

async function enforce(
  key: string,
  policy: RouteRateLimit,
  dependencies: RouteRateLimitDependencies
) {
  try {
    const result = await checkRateLimit(
      { ...policy, key },
      { store: dependencies.store }
    )
    return result.allowed ? null : rateLimitResponse(result.retryAfterSeconds)
  } catch {
    return unavailableResponse()
  }
}

export async function enforceIpRateLimit(
  request: Request,
  policy: RouteRateLimit,
  dependencies: RouteRateLimitDependencies = {}
): Promise<Response | null> {
  const production = dependencies.production ?? process.env.NODE_ENV === 'production'
  const trustedProxyHops = dependencies.trustedProxyHops
    ?? Number(process.env.TRUSTED_PROXY_HOPS ?? 0)
  const clientIp = getClientIp(request, trustedProxyHops)

  if (!clientIp) {
    if (production) return unavailableResponse()
    return enforce('local-development-client', policy, dependencies)
  }
  return enforce(clientIp, policy, dependencies)
}

export async function enforceUserRateLimit(
  userId: string,
  policy: RouteRateLimit,
  dependencies: Pick<RouteRateLimitDependencies, 'store'> = {}
): Promise<Response | null> {
  if (!userId) return unavailableResponse()
  return enforce(userId, policy, dependencies)
}

export function withIpRateLimit<RequestType extends Request, Args extends unknown[]>(
  handler: (request: RequestType, ...args: Args) => Response | Promise<Response>,
  policy: RouteRateLimit
) {
  return async (request: RequestType, ...args: Args): Promise<Response> => {
    const limited = await enforceIpRateLimit(request, policy)
    if (limited) return limited
    return handler(request, ...args)
  }
}
