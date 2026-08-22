import { prisma } from '@webreg/db'
import { enforceIpRateLimit, RATE_LIMITS } from '../../../../lib/route-security'

export async function GET(req: Request, { params }: { params: Promise<{ termId: string }> }) {
  const limited = await enforceIpRateLimit(req, RATE_LIMITS.catalog)
  if (limited) return limited

  const { termId } = await params
  const snapshot = await prisma.catalogSnapshot.findUnique({ where: { termId } })
  if (!snapshot) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  const etag = `"v${snapshot.version}"`
  const headers = { ETag: etag, 'Cache-Control': 'public, max-age=60' }

  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }

  return Response.json(snapshot.data, { headers })
}
