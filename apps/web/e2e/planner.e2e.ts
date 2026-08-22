import { expect, expectPlannedCourse, expectPlannerReady, planDemoA01, planLabA01, test } from './fixtures'

test('guest plans conflicting classes and retains them across every schedule view and reload', async ({ page }) => {
  await page.goto('/')
  await expectPlannerReady(page)

  await expect(page.getByRole('banner').getByText('Unofficial planning tool — cannot enroll', { exact: true })).toBeVisible()
  await expect(page.getByRole('contentinfo').getByText('Unofficial planning tool — cannot enroll', { exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Schedules are saved in this browser.')
  await expect(page.getByRole('button', { name: /^(Enroll|Drop|Wait ?list)$/i })).toHaveCount(0)

  await planDemoA01(page)
  await planLabA01(page)
  await page.getByRole('tab', { name: 'List' }).click()
  await expectPlannedCourse(page, 'DEMO 101')
  await expectPlannedCourse(page, 'LABX 150')

  await page.getByRole('tab', { name: 'Calendar' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'scheduling conflicts' })).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Calendar' }).getByText('DEMO 101 A01').first()).toBeVisible()

  await page.getByRole('tab', { name: 'Finals' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'exam overlaps' })).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: 'Finals' }).getByText('LABX 150 FI')).toBeVisible()

  await page.reload()
  await expectPlannerReady(page)
  await expectPlannedCourse(page, 'DEMO 101')
  await expectPlannedCourse(page, 'LABX 150')
})

test('guest schedule CRUD remains consistent', async ({ page }) => {
  await page.goto('/')
  await expectPlannerReady(page)

  await page.getByRole('button', { name: 'New', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'New schedule' })
  await dialog.getByRole('textbox', { name: 'Schedule name' }).fill('Alternate')
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('combobox', { name: 'Active schedule' }).getByRole('option', { name: 'Alternate' })).toHaveCount(1)

  await page.getByRole('combobox', { name: 'Active schedule' }).selectOption({ label: 'Alternate' })
  await page.getByRole('button', { name: 'Rename' }).click()
  dialog = page.getByRole('dialog', { name: 'Rename Alternate' })
  await dialog.getByRole('textbox', { name: 'Schedule name' }).fill('Renamed')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('combobox', { name: 'Active schedule' }).getByRole('option', { name: 'Renamed' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Copy' }).click()
  dialog = page.getByRole('dialog', { name: 'Copy Renamed' })
  await dialog.getByRole('textbox', { name: 'Schedule name' }).fill('Backup')
  await dialog.getByRole('button', { name: 'Copy' }).click()
  await expect(page.getByRole('combobox', { name: 'Active schedule' }).getByRole('option', { name: 'Backup' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Delete' }).click()
  dialog = page.getByRole('dialog', { name: 'Delete Renamed' })
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('combobox', { name: 'Active schedule' }).getByRole('option', { name: 'Renamed' })).toHaveCount(0)
})

test('guest schedules remain isolated when terms switch', async ({ page }) => {
  await page.goto('/')
  await expectPlannerReady(page)
  await planDemoA01(page)
  await page.getByRole('tab', { name: 'List' }).click()
  await expectPlannedCourse(page, 'DEMO 101')

  const term = page.getByRole('combobox', { name: 'Academic term' })
  await term.selectOption('WI27')
  await expect(term).toHaveValue('WI27')
  await expect(page.getByText('No classes on your schedule for this term.')).toBeVisible()

  await term.selectOption('FA26')
  await expect(term).toHaveValue('FA26')
  await expectPlannedCourse(page, 'DEMO 101')
})
