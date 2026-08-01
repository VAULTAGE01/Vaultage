import { expect } from 'vitest'
import type { Page } from 'playwright-core'

const TARGET_FOLDER = 'Synthetic Drop Target'
const SECRET_TITLE = 'Synthetic Local API Key'

export async function verifyCommunitySidebarSecretDragDrop(page: Page): Promise<void> {
  const navigation = page.locator('aside[aria-label="Application navigation"]')
  const rootFolder = navigation.getByText('My Vault', { exact: true }).last().locator('xpath=ancestor::button[1]')

  if (await rootFolder.getAttribute('aria-expanded') !== 'true') await rootFolder.click()
  await navigation.getByTitle('New folder').click()

  const dialog = page.getByRole('dialog', { name: 'New folder' })
  await dialog.getByLabel('Folder name', { exact: true }).fill(TARGET_FOLDER)
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click()

  const targetFolder = navigation.getByRole('button').filter({ hasText: TARGET_FOLDER })
  await targetFolder.waitFor({ state: 'visible', timeout: 10_000 })
  const initialRootCount = await itemCount(rootFolder)

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
  await expect.poll(async () => await itemCount(rootFolder), { timeout: 10_000 })
    .toBe(initialRootCount - 1)
  await expect.poll(async () => await targetFolder.textContent(), { timeout: 10_000 })
    .toMatch(/1\s*$/u)

  await targetFolder.click()
  await secret.waitFor({ state: 'visible', timeout: 10_000 })

  await secret.dragTo(rootFolder)
  await expect.poll(async () => await itemCount(rootFolder), { timeout: 10_000 })
    .toBe(initialRootCount)
  await expect.poll(async () => await targetFolder.textContent(), { timeout: 10_000 })
    .toMatch(/0\s*$/u)
  await secret.waitFor({ state: 'visible', timeout: 10_000 })
}

async function itemCount(locator: { textContent: () => Promise<string | null> }): Promise<number> {
  const match = (await locator.textContent())?.match(/(\d+)\s*$/u)
  if (!match) throw new Error('Sidebar folder count is unavailable')
  return Number(match[1])
}
