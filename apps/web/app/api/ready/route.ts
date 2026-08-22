import { checkReadiness } from '../../../lib/readiness'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export async function GET() {
  const ok = await checkReadiness()
  return Response.json(
    { ok },
    { status: ok ? 200 : 503, headers: NO_STORE_HEADERS }
  )
}
