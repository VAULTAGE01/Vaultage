import type { Page } from 'playwright-core'

export async function verifyCommunityVaultControls(page: Page): Promise<void> {
  await page.keyboard.press('Meta+,')

  const settings = page.getByRole('dialog', { name: 'Vault Settings' })
  await settings.waitFor({ state: 'visible', timeout: 10_000 })
  await settings.getByText('Change master password', { exact: true }).waitFor()
  await settings.getByText('6-digit reveal PIN', { exact: true }).waitFor()
  await settings.getByText('Audit log', { exact: true }).waitFor()

  await settings.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click()
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
  await shortcuts.waitFor({ state: 'visible', timeout: 10_000 })
  await page.keyboard.press('Escape')

  await page.keyboard.press('Meta+Shift+E')
  await page.getByRole('dialog', { name: 'Export Vault' })
    .waitFor({ state: 'visible', timeout: 10_000 })
  await page.keyboard.press('Escape')

  await page.keyboard.press('Meta+,')
  await page.getByRole('dialog', { name: 'Vault Settings' })
    .getByRole('button', { name: 'Change master password', exact: true })
    .click()
  await page.getByText('Change Master Password', { exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 })
  await page.keyboard.press('Escape')
}
