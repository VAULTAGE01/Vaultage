import { expect } from 'vitest'
import type { Page } from 'playwright-core'

export type ProjectMappingFixture = {
  readonly fieldKey: string
  readonly projectName: string
  readonly secretTitle: string
}

type VisibleProjectCreationError = {
  waitFor: (options?: { state?: 'visible'; timeout?: number }) => Promise<void>
  innerText: () => Promise<string>
}

type ProjectCreationErrorScope = {
  locator: (selector: string) => VisibleProjectCreationError & {
    first: () => VisibleProjectCreationError
  }
}

export function locateProjectCreationError(modal: ProjectCreationErrorScope): VisibleProjectCreationError {
  return modal
    .locator('div[class~="border-danger/30"][class~="bg-danger/10"][class~="text-danger"]')
    .first()
}

export async function readVisibleProjectCreationError(error: VisibleProjectCreationError): Promise<string> {
  await error.waitFor({ state: 'visible', timeout: 15_000 })
  let message = ''
  await expect.poll(
    async () => {
      message = (await error.innerText()).trim()
      return message
    },
    { timeout: 15_000 },
  ).not.toBe('')
  return message
}

export async function createProjectMapping(page: Page, fixture: ProjectMappingFixture): Promise<void> {
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click()
  await page.getByText('Local Project Mappings', { exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'New Project', exact: true }).click()
  await page.getByText('Attach local folder', { exact: true }).click()
  await page.getByRole('button', { name: 'Choose Folder', exact: true }).click()
  await page.getByPlaceholder('Project name').fill(fixture.projectName)
  const mapping = page.getByText(fixture.fieldKey, { exact: true }).first().locator('xpath=ancestor::div[.//select][1]')
  await mapping.locator('select').nth(0).selectOption({ label: `My Vault / ${fixture.secretTitle}` })
  await mapping.locator('select').nth(1).selectOption({ label: fixture.fieldKey })
  await page.getByRole('button', { name: 'Create Project', exact: true }).click()
  const modal = page.locator('.liquid-modal-shell')
  const projectName = page.getByText(fixture.projectName, { exact: true }).first()
  const creationError = locateProjectCreationError(modal)
  const outcome = await Promise.race([
    projectName.waitFor({ state: 'visible', timeout: 15_000 }).then(() => ({ kind: 'created' as const })),
    readVisibleProjectCreationError(creationError).then(message => ({
      kind: 'rejected' as const,
      message,
    })),
  ])
  if (outcome.kind === 'rejected') {
    if (!outcome.message) throw new Error('Project creation showed an empty visible rejection')
    throw new Error(`Project creation was rejected by the real UI: ${outcome.message}`)
  }
  await modal.locator(':scope > div:first-child > button').click()
  await modal.waitFor({ state: 'hidden' })
  await assertExactProjectMapping(page, fixture)
}

export async function assertExactProjectMapping(page: Page, fixture: ProjectMappingFixture): Promise<void> {
  await page.getByText(fixture.projectName, { exact: true }).first().click()
  const row = page.getByText(fixture.fieldKey, { exact: true }).first()
    .locator('xpath=ancestor::div[contains(@class,"md:grid-cols")][1]')
  const text = await row.innerText()
  expect(text).toContain(fixture.secretTitle)
  expect(text).toContain(fixture.fieldKey)
  expect(text).toContain('Ready')
}
