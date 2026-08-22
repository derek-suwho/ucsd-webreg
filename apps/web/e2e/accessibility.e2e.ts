import AxeBuilder from '@axe-core/playwright'
import { expect, expectPlannerReady, planDemoA01, test } from './fixtures'
import type { Page } from '@playwright/test'

async function expectNoSeriousOrCriticalViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const violations = results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map(node => node.target) }))
  expect(violations).toEqual([])
}

test('planner and a populated planning dialog have no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expectPlannerReady(page)
  await expectNoSeriousOrCriticalViolations(page)

  await planDemoA01(page)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New schedule' })).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)
})

for (const path of ['/privacy', '/terms']) {
  test(`${path.slice(1)} page has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNoSeriousOrCriticalViolations(page)
  })
}
