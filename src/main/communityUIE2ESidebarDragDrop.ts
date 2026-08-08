import { expect } from 'vitest'
import type { Page } from 'playwright-core'

const TARGET_FOLDER = 'Synthetic Drop Target'
const SECRET_TITLE = 'Synthetic Local API Key'

export async function verifyCommunitySidebarSecretDragDrop(page: Page): Promise<void> {
  const navigation = page.locator('aside[aria-label="Application navigation"]')
  const activeVaultRoot = navigation.locator(
    '[data-vault-hierarchy="sidebar"] [data-vault-action="switch"][aria-current="true"]',
  )

  await activeVaultRoot.waitFor({ state: 'visible', timeout: 10_000 })
  await navigation.getByTitle('New folder').click()

  const dialog = page.getByRole('dialog', { name: 'New folder' })
  await dialog.getByLabel('Folder name', { exact: true }).fill(TARGET_FOLDER)
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click()

  const targetFolder = navigation.getByRole('button').filter({ hasText: TARGET_FOLDER })
  await targetFolder.waitFor({ state: 'visible', timeout: 10_000 })

  const secret = navigation.getByRole('button', { name: SECRET_TITLE, exact: true })
  await secret.waitFor({ state: 'visible', timeout: 10_000 })
  expect(
    await secret.getAttribute('draggable'),
    'Community secret rows must expose the closed-app drag interaction',
  ).toBe('true')
  expect(
    await secret.getAttribute('title'),
    'Community secret rows must explain their drag interaction before it begins',
  ).toContain('drag to move it to another folder')

  await secret.dragTo(targetFolder)
  await expect.poll(async () => await targetFolder.textContent(), { timeout: 10_000 })
    .toMatch(/1\s*$/u)

  await targetFolder.click()
  await secret.waitFor({ state: 'visible', timeout: 10_000 })

  await secret.dragTo(activeVaultRoot)
  await expect.poll(async () => await targetFolder.textContent(), { timeout: 10_000 })
    .toMatch(/0\s*$/u)
  await secret.waitFor({ state: 'visible', timeout: 10_000 })
}
