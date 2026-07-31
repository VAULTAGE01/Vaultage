import { expect } from 'vitest'
import type { Page } from 'playwright-core'

export async function verifyCommunitySecretContext(page: Page): Promise<void> {
  const navigation = page.locator('aside[aria-label="Application navigation"]')
  const secret = navigation.getByRole('button', { name: 'Synthetic Local API Key', exact: true })
  const sourceFolder = navigation.getByRole('button').filter({ hasText: 'Synthetic Local Folder' })
  if (!(await secret.isVisible().catch(() => false))) await sourceFolder.click()
  await secret.click()

  const main = page.locator('main')
  await main.getByText('Context', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  await main.getByText('Activity', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

  const access = main.getByRole('checkbox', { name: 'Allow reveal and copy', exact: true })
  const copy = main.getByRole('button', { name: 'Copy', exact: true }).first()
  expect(await access.isChecked()).toBe(true)
  expect(await copy.isEnabled()).toBe(true)

  await access.uncheck()
  await expect.poll(async () => await copy.isDisabled(), { timeout: 10_000 }).toBe(true)
  await access.check()
  await expect.poll(async () => await copy.isEnabled(), { timeout: 10_000 }).toBe(true)
}
