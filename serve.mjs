import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { connect } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

export function isServerRunning(port = 3000) {
  return new Promise(resolveProbe => {
    const probe = connect({ host: '127.0.0.1', port })
    let settled = false
    const settle = running => {
      if (settled) return
      settled = true
      probe.destroy()
      resolveProbe(running)
    }
    probe.setTimeout(750)
    probe.once('connect', () => {
      settle(true)
    })
    probe.once('timeout', () => {
      settle(false)
    })
    probe.once('error', () => settle(false))
  })
}

function successfulHttpProbe(port) {
  return new Promise(resolveProbe => {
    const probe = request({ hostname: '127.0.0.1', port, path: '/', method: 'HEAD', timeout: 1_000 }, response => {
      response.resume()
      resolveProbe(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 400)
    })
    probe.once('timeout', () => {
      probe.destroy()
      resolveProbe(false)
    })
    probe.once('error', () => resolveProbe(false))
    probe.end()
  })
}

export async function waitForServerReady({ port = 3000, timeoutMs = 15_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await successfulHttpProbe(port)) return
    await new Promise(resolveWait => setTimeout(resolveWait, intervalMs))
  }
  throw new Error(`Local server at http://localhost:${port} did not become ready`)
}

export async function ensureLocalServer({ port = 3000, spawnProcess = spawn } = {}) {
  if (await isServerRunning(port)) {
    process.stdout.write(`Using existing server at http://localhost:${port}\n`)
    return null
  }

  const production = process.env.PLANNER_SERVE_MODE === 'production'
  const script = production ? 'start' : 'dev'
  const child = spawnProcess(
    'npm',
    ['run', script, '-w', '@webreg/web', '--', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: PROJECT_ROOT, detached: process.platform !== 'win32', env: process.env, stdio: 'inherit' }
  )
  return child
}

export function stopLocalServer(child, signal = 'SIGTERM', killProcess = process.kill) {
  if (process.platform !== 'win32' && typeof child.pid === 'number') {
    try {
      killProcess(-child.pid, signal)
      return
    } catch {
      // Fall back when the injected child is not a process-group leader.
    }
  }
  child.kill(signal)
}

async function main() {
  const child = await ensureLocalServer()
  if (child) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => stopLocalServer(child, signal))
    }
    child.once('exit', code => {
      process.exitCode = code ?? 1
    })
  }

  try {
    await waitForServerReady()
    process.stdout.write('Server ready at http://localhost:3000\n')
  } catch (error) {
    if (child) stopLocalServer(child)
    throw error
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryUrl === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Could not start local server'}\n`)
    process.exitCode = 1
  })
}
