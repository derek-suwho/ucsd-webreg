import { createHash } from 'node:crypto'
import { expect, test as base, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { encode } from 'next-auth/jwt'
import { prisma } from '@webreg/db'

export { expect }
export const test = base

const SESSION_COOKIE = 'authjs.session-token'

export async function signInTestUser(context: BrowserContext, testInfo: TestInfo) {
  const fingerprint = createHash('sha256')
    .update(`${testInfo.project.name}:${testInfo.testId}:${testInfo.retry}`)
    .digest('hex')
    .slice(0, 16)
  const email = `planner-e2e-${fingerprint}@example.test`
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Planner E2E User' },
    update: { name: 'Planner E2E User' }
  })
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for authenticated E2E tests')
  const token = await encode({
    secret,
    salt: SESSION_COOKIE,
    token: { uid: user.id, name: user.name, email: user.email }
  })
  await context.addCookies([{
    name: SESSION_COOKIE,
    value: token,
    url: 'http://localhost:3100',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax'
  }])
  return user
}

export async function expectPlannerReady(page: Page): Promise<void> {
  await expect(page.getByRole('combobox', { name: 'Academic term' })).toHaveValue('FA26')
  await expect(page.getByText('Demo catalog — not live seat data', { exact: true }).last()).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Active schedule' })).not.toHaveValue('')
}

export async function openCourse(page: Page, query: string, courseLabel: RegExp): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search for Classes:' }).fill(query)
  const course = page.getByRole('button', { name: courseLabel })
  await expect(course).toBeVisible()
  await course.click()
}

export async function planDemoA01(page: Page): Promise<void> {
  await openCourse(page, 'DEMO 101', /DEMO 101/)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Choose a section/ })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: /^A01/ }).check()
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  await expect(dialog).toBeHidden()
}

export async function planLabA01(page: Page): Promise<void> {
  await openCourse(page, 'LABX 150', /LABX 150/)
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
}

export async function expectPlannedCourse(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('table', { name: 'Planned classes' }).getByText(label, { exact: true }).first()).toBeVisible()
}
