import { describe, expect, it } from 'vitest'
import { readBoundedJson } from './bounded-json'

const MAX_BYTES = 16 * 1024

describe('readBoundedJson', () => {
  it('accepts valid JSON without a content-length header', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":true}'))
          controller.close()
        }
      }),
      duplex: 'half'
    } as RequestInit)

    await expect(readBoundedJson(request, MAX_BYTES)).resolves.toEqual({ ok: true })
  })

  it('rejects an invalid content-length header', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-length': 'not-a-number' },
      body: '{}'
    })

    await expect(readBoundedJson(request, MAX_BYTES)).rejects.toThrow('invalid content length')
  })

  it('rejects a declared body larger than the limit', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-length': String(MAX_BYTES + 1) },
      body: '{}'
    })

    await expect(readBoundedJson(request, MAX_BYTES)).rejects.toThrow('body too large')
  })

  it('rejects a streamed payload larger than the limit', async () => {
    let cancelled = false
    const request = new Request('http://localhost', {
      method: 'POST',
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(MAX_BYTES + 1))
        },
        cancel() {
          cancelled = true
        }
      }),
      duplex: 'half'
    } as RequestInit)

    await expect(readBoundedJson(request, MAX_BYTES)).rejects.toThrow('body too large')
    expect(cancelled).toBe(true)
  })

  it('parses valid UTF-8 JSON', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: '日本語' })
    })

    await expect(readBoundedJson(request, MAX_BYTES)).resolves.toEqual({ name: '日本語' })
  })

  it('rejects malformed JSON', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: '{"broken":'
    })

    await expect(readBoundedJson(request, MAX_BYTES)).rejects.toThrow()
  })
})
