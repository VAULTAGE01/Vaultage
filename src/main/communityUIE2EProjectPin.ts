import { expect } from 'vitest'
import type { Page } from 'playwright-core'

export async function verifyCommunityProjectPin(page: Page): Promise<void> {
  const navigation = page.locator('aside[aria-label="Application navigation"]')
  const pin = navigation.getByRole('button', { name: 'Pin Project', exact: true })
  await pin.click()
  const unpin = navigation.getByRole('button', { name: 'Unpin Project', exact: true })
  await expect.poll(async () => await unpin.getAttribute('aria-pressed'), { timeout: 10_000 })
    .toBe('true')
}
