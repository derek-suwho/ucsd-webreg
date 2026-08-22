export const MAX_SCHEDULES_PER_USER = 20
export const MAX_SCHEDULE_ITEMS = 40
export const MAX_IDENTIFIER_LENGTH = 128
export const MAX_JSON_BODY_BYTES = 16 * 1024

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new Error('invalid content length')
    }
    if (Number(contentLength) > maxBytes) {
      throw new Error('body too large')
    }
  }

  const reader = request.body?.getReader()
  if (!reader) {
    throw new SyntaxError('missing JSON body')
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error('body too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
