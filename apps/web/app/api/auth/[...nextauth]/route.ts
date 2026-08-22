import { handlers } from '../../../../lib/auth'
import { RATE_LIMITS, withIpRateLimit } from '../../../../lib/route-security'

export const GET = withIpRateLimit(handlers.GET, RATE_LIMITS.auth)
export const POST = withIpRateLimit(handlers.POST, RATE_LIMITS.auth)
