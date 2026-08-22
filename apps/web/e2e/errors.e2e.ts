import { expect, expectPlannedCourse, expectPlannerReady, planDemoA01, signInTestUser, test } from './fixtures'

test('terms failure exposes retry and recovers through the real API', async ({ page }) => {
  let termsAvailable = false
  await page.route('**/api/terms', async route => {
    if (!termsAvailable) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary"}' })
      return
    }
    await route.fallback()
  })

  await page.goto('/')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load terms' })).toBeVisible()
  termsAvailable = true
  await page.getByRole('button', { name: 'Retry terms' }).click()
  await expectPlannerReady(page)
})

test('catalog failure exposes retry and recovers through the real API', async ({ page }) => {
  let failOnce = true
  await page.route('**/api/catalog/FA26', async route => {
    if (failOnce) {
      failOnce = false
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary"}' })
      return
    }
    await route.fallback()
  })

  await page.goto('/')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load catalog' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry catalog' }).click()
  await expectPlannerReady(page)
})

test('authenticated save failure retains local work and retries the same schedule', async ({ page, context }, testInfo) => {
  await signInTestUser(context, testInfo)
  let failOnce = true
  await page.route('**/api/schedules/*/items', async route => {
    if (route.request().method() === 'PUT' && failOnce) {
      failOnce = false
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary"}' })
      return
    }
    await route.fallback()
  })

  await page.goto('/')
  await expectPlannerReady(page)
  await planDemoA01(page)
  await expect(page.getByText(/Couldn’t save/)).toBeVisible()
  await expectPlannedCourse(page, 'DEMO 101')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  await page.reload()
  await expectPlannerReady(page)
  await expectPlannedCourse(page, 'DEMO 101')
})
