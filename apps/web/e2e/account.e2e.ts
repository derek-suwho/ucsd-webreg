import { readFile } from 'node:fs/promises'
import { prisma } from '@webreg/db'
import { expect, expectPlannedCourse, expectPlannerReady, planDemoA01, signInTestUser, test } from './fixtures'

test('account schedules persist, export without profile data, and are deleted with the account', async ({ page, context }, testInfo) => {
  const user = await signInTestUser(context, testInfo)
  await page.goto('/')
  await expectPlannerReady(page)
  await expect(page.getByText('Planner E2E User', { exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Schedules are saved to your account.')

  await planDemoA01(page)
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await expectPlannerReady(page)
  await expectPlannedCourse(page, 'DEMO 101')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export schedules' }).click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  if (!downloadPath) throw new Error('Export download did not produce a local file')
  const exported = JSON.parse(await readFile(downloadPath, 'utf8')) as Record<string, unknown>
  expect(Object.keys(exported).sort()).toEqual(['generatedAt', 'schedules', 'schemaVersion'])
  expect(exported.schemaVersion).toBe(1)
  expect(JSON.stringify(exported)).not.toContain(user.email)
  expect(JSON.stringify(exported)).toContain('FA26:DEMO:101:A01')

  await page.getByRole('button', { name: 'Delete account' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete account' })
  await dialog.getByRole('textbox', { name: 'Confirmation' }).fill('DELETE')
  await dialog.getByRole('button', { name: 'Permanently delete account' }).click()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()

  await expect.poll(() => prisma.user.findUnique({ where: { id: user.id } })).toBeNull()
  await expect.poll(() => prisma.schedule.count({ where: { userId: user.id } })).toBe(0)
  const unauthorized = await page.request.get('/api/account/export')
  expect(unauthorized.status()).toBe(401)
})
