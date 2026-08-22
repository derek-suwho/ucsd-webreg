import { access, mkdir, open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIRECTORY = join(PROJECT_ROOT, 'temporary screenshots')
const LOCAL_ORIGIN = 'http://localhost:3000'

function sanitizedLabel(label) {
  if (label === undefined || label === '') return ''
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(label)) throw new Error('Invalid screenshot label')
  return label.toLowerCase()
}

export function validateLocalUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Screenshot URL must use http://localhost:3000')
  }
  if (url.origin !== LOCAL_ORIGIN || url.username || url.password) {
    throw new Error('Screenshot URL must use http://localhost:3000')
  }
  sanitizedLabel(label)
  return url
}

export async function nextScreenshotPath(directory = OUTPUT_DIRECTORY, label) {
  const suffix = sanitizedLabel(label)
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  let number = entries.reduce((max, entry) => {
    const match = /^(?:\.screenshot-(\d+)\.lock|screenshot-(\d+)(?:-[a-z0-9_-]+)?\.png)$/i.exec(entry)
    return match ? Math.max(max, Number(match[1] ?? match[2])) : max
  }, 0) + 1

  while (true) {
    const path = join(directory, `screenshot-${number}${suffix ? `-${suffix}` : ''}.png`)
    const lockPath = join(directory, `.screenshot-${number}.lock`)
    try {
      const lock = await open(lockPath, 'wx')
      await lock.close()
      const reservation = await open(path, 'wx')
      await reservation.close()
      return path
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'EEXIST') {
        number += 1
        continue
      }
      throw error
    }
  }
}

async function existingFile(path) {
  try {
    await access(path)
    return path
  } catch {
    return null
  }
}

export async function findCachedChrome(cacheRoot = join(homedir(), '.cache', 'puppeteer')) {
  const productDirectory = join(cacheRoot, 'chrome-headless-shell')
  let versions
  try {
    versions = await readdir(productDirectory, { withFileTypes: true })
  } catch {
    throw new Error(`No cached Chrome found under ${cacheRoot}`)
  }
  versions = versions
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))

  for (const version of versions) {
    const versionDirectory = join(productDirectory, version)
    const bundles = await readdir(versionDirectory, { withFileTypes: true })
    for (const bundle of bundles.filter(entry => entry.isDirectory())) {
      const executableName = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'
      const executable = await existingFile(join(versionDirectory, bundle.name, executableName))
      if (executable) return executable
    }
  }
  throw new Error(`No cached Chrome executable found under ${cacheRoot}`)
}

function viewportValue(name, fallback, minimum, maximum) {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

export function demoGuestStorage() {
  return {
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
  }
}

export function plannerCaptureReady() {
  const planner = document.querySelector('.planner-content')
  if (!planner) return true
  const text = document.body.innerText
  if (text.includes('Loading academic terms') || text.includes('Loading catalog')) return false
  return Boolean(planner.querySelector('time[datetime], .planner-print-hidden [role="alert"]')) ||
    text.includes('No academic terms available')
}

export async function preparePageForCapture(page) {
  await page.waitForFunction(plannerCaptureReady, { timeout: 15_000 })
  const loadError = await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready
    document.querySelectorAll('nextjs-portal').forEach(portal => portal.remove())
    const alert = [...document.querySelectorAll('.planner-content .planner-print-hidden [role="alert"]')][0]
    return alert?.textContent?.trim().slice(0, 200) ?? null
  })
  if (loadError) throw new Error(`Planner load failed: ${loadError}`)
}

export function assertSuccessfulNavigation(response, pageUrl) {
  if (!response) throw new Error('Screenshot navigation returned no response')
  if (!response.ok()) {
    const status = response.status()
    throw new Error(`Screenshot navigation failed with HTTP ${Number.isInteger(status) ? status : 'error'}`)
  }
  for (const [source, value] of [['response', response.url()], ['page', pageUrl]]) {
    let finalUrl
    try {
      finalUrl = new URL(value)
    } catch {
      throw new Error(`Screenshot ${source} URL must use http://localhost:3000`)
    }
    if (finalUrl.origin !== LOCAL_ORIGIN || finalUrl.username || finalUrl.password) {
      throw new Error(`Screenshot ${source} URL must use http://localhost:3000`)
    }
  }
}

export async function selectPlannerTab(page, value) {
  if (value === undefined || value === '') return
  const labels = { list: 'List', calendar: 'Calendar', finals: 'Finals' }
  const label = labels[value]
  if (!label) throw new Error('SCREENSHOT_TAB must be list, calendar, or finals')
  const selected = await page.evaluate(async tabLabel => {
    const button = [...document.querySelectorAll('button')]
      .find(candidate => candidate.textContent?.trim() === tabLabel)
    if (!button) return false
    button.click()
    await new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
    return true
  }, label)
  if (!selected) throw new Error(`Could not select ${label} tab`)
}

export async function capture(urlValue, label) {
  const url = validateLocalUrl(urlValue, label)
  const browser = await puppeteer.launch({
    executablePath: await findCachedChrome(),
    headless: true
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({
      width: viewportValue('SCREENSHOT_WIDTH', 1502, 320, 3840),
      height: viewportValue('SCREENSHOT_HEIGHT', 812, 320, 2160),
      deviceScaleFactor: 1
    })
    if (process.env.SCREENSHOT_DEMO_SCHEDULE === '1') {
      await page.evaluateOnNewDocument(storage => {
        window.localStorage.setItem('webreg-guest-v2', JSON.stringify(storage))
      }, demoGuestStorage())
    }
    const media = process.env.SCREENSHOT_MEDIA ?? 'screen'
    if (media !== 'screen' && media !== 'print') throw new Error('SCREENSHOT_MEDIA must be screen or print')
    await page.emulateMediaType(media)
    const response = await page.goto(url.href, { waitUntil: 'networkidle2', timeout: 30_000 })
    assertSuccessfulNavigation(response, page.url())
    await preparePageForCapture(page)
    await selectPlannerTab(page, process.env.SCREENSHOT_TAB)
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth
    }))
    const outputPath = await nextScreenshotPath(OUTPUT_DIRECTORY, label)
    await page.screenshot({ path: outputPath, fullPage: true })
    process.stdout.write(`${outputPath}\n`)
    process.stdout.write(`viewport=${overflow.viewport} content=${overflow.content} overflow=${overflow.content > overflow.viewport}\n`)
    return { outputPath, overflow }
  } finally {
    await browser.close()
  }
}

async function main() {
  const [urlValue, label] = process.argv.slice(2)
  if (!urlValue) throw new Error('Usage: node screenshot.mjs http://localhost:3000 [label]')
  await capture(urlValue, label)
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryUrl === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Screenshot failed'}\n`)
    process.exitCode = 1
  })
}
