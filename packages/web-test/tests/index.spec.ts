import { expect, test } from '@playwright/test'

test('build blocks successfully', async ({ page }) => {
  test.slow()

  await page.goto('http://localhost:3000')

  // starts with Loading...
  await expect(page.locator('div#app')).toHaveText(/Loading.../)

  // chain is ready
  await expect(page.locator('div#app')).toHaveText(/4000000/, { timeout: 60_000 })

  // wait for new block
  await expect(page.locator('div#app')).toHaveText(/4000001/, { timeout: 120_000 })
})
