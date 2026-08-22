const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export function GET() {
  return Response.json({ ok: true }, { headers: NO_STORE_HEADERS })
}
