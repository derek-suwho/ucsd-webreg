import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertSuccessfulNavigation, demoGuestStorage, nextScreenshotPath, plannerCaptureReady, preparePageForCapture, selectPlannerTab, validateLocalUrl } from './screenshot.mjs'
import { ensureLocalServer, isServerRunning, stopLocalServer, waitForServerReady } from './serve.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('screenshot workflow', () => {
  it('pins a Puppeteer release compatible with the declared Node 20 floor', async () => {
    const rootPackage = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
    const puppeteerPackage = JSON.parse(await readFile(new URL('./node_modules/puppeteer-core/package.json', import.meta.url), 'utf8'))

    expect(rootPackage.devDependencies['puppeteer-core']).toBe('24.37.5')
    expect(puppeteerPackage.version).toBe('24.37.5')
    expect(puppeteerPackage.engines.node).toBe('>=18')
  })

  it('accepts only the exact local HTTP origin and rejects unsafe labels', () => {
    expect(validateLocalUrl('http://localhost:3000/path').href).toBe('http://localhost:3000/path')
    for (const value of ['https://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:4000', 'http://example.com:3000']) {
      expect(() => validateLocalUrl(value)).toThrow(/localhost/i)
    }
    expect(() => validateLocalUrl('http://localhost:3000', '../escape')).toThrow(/label/i)
  })

  it('rejects missing, unsuccessful, or off-origin final navigation', () => {
    expect(() => assertSuccessfulNavigation(null)).toThrow(/response/i)
    expect(() => assertSuccessfulNavigation({ ok: () => false, status: () => 500, url: () => 'http://localhost:3000/' }, 'http://localhost:3000/')).toThrow(/500/)
    expect(() => assertSuccessfulNavigation({ ok: () => true, status: () => 200, url: () => 'https://example.com/' }, 'https://example.com/')).toThrow(/localhost/i)
    expect(() => assertSuccessfulNavigation({ ok: () => true, status: () => 200, url: () => 'http://localhost:3000/' }, 'https://example.com/')).toThrow(/localhost/i)
    expect(() => assertSuccessfulNavigation({ ok: () => true, status: () => 200, url: () => 'http://localhost:3000/planner' }, 'http://localhost:3000/planner')).not.toThrow()
  })

  it('increments screenshot names without overwriting earlier captures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'webreg-screenshots-'))
    temporaryDirectories.push(directory)
    await writeFile(join(directory, 'screenshot-1.png'), '')
    await writeFile(join(directory, 'screenshot-3-desktop.png'), '')

    await expect(nextScreenshotPath(directory, 'round-2')).resolves.toBe(join(directory, 'screenshot-4-round-2.png'))
  })

  it('allocates unique sequence numbers across concurrent labels', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'webreg-screenshots-'))
    temporaryDirectories.push(directory)

    const paths = await Promise.all([
      nextScreenshotPath(directory, 'mobile'),
      nextScreenshotPath(directory, 'desktop'),
      nextScreenshotPath(directory, 'print')
    ])

    expect(paths.map(path => Number(/screenshot-(\d+)/.exec(path)?.[1])).sort()).toEqual([1, 2, 3])
  })

  it('waits for application loading to finish and removes only the Next development portal', async () => {
    const portal = { remove: vi.fn() }
    vi.stubGlobal('document', {
      body: { innerText: '' },
      fonts: { ready: Promise.resolve() },
      querySelector: vi.fn().mockReturnValue(null),
      querySelectorAll: vi.fn(selector => selector === 'nextjs-portal' ? [portal] : [])
    })
    const page = {
      waitForFunction: vi.fn(async callback => callback()),
      evaluate: vi.fn(async callback => callback())
    }

    await preparePageForCapture(page)

    expect(page.waitForFunction).toHaveBeenCalledOnce()
    expect(portal.remove).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('does not treat the planner idle shell as capture-ready', () => {
    const planner = { querySelector: vi.fn().mockReturnValue(null) }
    vi.stubGlobal('document', {
      body: { innerText: '' },
      querySelector: vi.fn().mockReturnValue(planner)
    })
    expect(plannerCaptureReady()).toBe(false)
    planner.querySelector.mockReturnValue({})
    expect(plannerCaptureReady()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('provides a bounded fixture-backed guest schedule for visual checks', () => {
    expect(demoGuestStorage()).toEqual({
      version: 2,
      terms: {
        FA26: {
          schedules: [{
            id: 'visual-check',
            name: 'Sample Plan',
            sectionIds: ['FA26:DEMO:101:A01', 'FA26:LABX:150:A01']
          }],
          activeScheduleId: 'visual-check'
        }
      }
    })
  })

  it('selects only a known planner tab for visual checks', async () => {
    const page = { evaluate: vi.fn().mockResolvedValue(true) }
    await expect(selectPlannerTab(page, 'calendar')).resolves.toBeUndefined()
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'Calendar')
    await expect(selectPlannerTab(page, 'search')).rejects.toThrow(/tab/i)
  })
})

describe('local server workflow', () => {
  it('detects a TCP listener that accepts connections without answering HTTP', async () => {
    const server = createTcpServer(() => {})
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test port')

    expect(await isServerRunning(address.port)).toBe(true)
    const spawnProcess = vi.fn()
    await expect(ensureLocalServer({ port: address.port, spawnProcess })).resolves.toBeNull()
    expect(spawnProcess).not.toHaveBeenCalled()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  it('detects an existing listener and never starts a duplicate process', async () => {
    const server = createServer((_request, response) => response.end('ok'))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test port')

    expect(await isServerRunning(address.port)).toBe(true)
    const spawnProcess = vi.fn()
    await expect(ensureLocalServer({ port: address.port, spawnProcess })).resolves.toBeNull()
    expect(spawnProcess).not.toHaveBeenCalled()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  it('waits for a successful HTTP response separately from listener detection', async () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.statusCode = requests === 1 ? 503 : 200
      response.end()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test port')

    await expect(waitForServerReady({ port: address.port, timeoutMs: 500, intervalMs: 5 })).resolves.toBeUndefined()
    expect(requests).toBeGreaterThanOrEqual(2)
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  it('starts a process group and stops the full server tree', async () => {
    const child = { pid: 123, kill: vi.fn() }
    const spawnProcess = vi.fn(() => child)
    await ensureLocalServer({ port: 65534, spawnProcess })

    expect(spawnProcess).toHaveBeenCalledWith(
      'npm',
      expect.any(Array),
      expect.objectContaining({ detached: process.platform !== 'win32' })
    )

    const killProcess = vi.fn()
    stopLocalServer(child, 'SIGTERM', killProcess)
    if (process.platform === 'win32') expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    else expect(killProcess).toHaveBeenCalledWith(-123, 'SIGTERM')
  })
})
