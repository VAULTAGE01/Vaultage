import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import type { ElectronApplication, Page } from 'playwright-core'
import {
  assertCommunityUIE2ECheckpoint,
  assertEncryptedCommunityProfile,
  readAndClearE2EClipboard,
  type CommunityUIE2ECheckpoint,
  type CommunityUIE2EPersistence,
} from './communityUIE2EAssertions'
import {
  cleanupCommunityUIE2EResources,
  closeCommunityUIE2E,
  createCommunityUIE2EResources,
  installProjectFolderDialog,
  launchCommunityUIE2E,
} from './communityUIE2ERun'
import {
  assertExactProjectMapping,
  createProjectMapping,
} from './communityUIE2EProjectMapping'
import { verifyCommunitySidebarSecretDragDrop } from './communityUIE2ESidebarDragDrop'
import { verifyCommunityVaultControls } from './communityUIE2EVaultControls'
import { verifyCommunitySecretContext } from './communityUIE2ESecretContext'
import { verifyCommunityProjectPin } from './communityUIE2EProjectPin'

const SCENARIO_NAMES = [
  'setup',
  'sidebar-drag-drop',
  'secret-context',
  'vault-controls',
  'persistence',
  'project-mapping',
] as const
type ScenarioName = (typeof SCENARIO_NAMES)[number]

const SYNTHETIC_PASSWORD = 'local-e2e-master-password-2026!'
const SYNTHETIC_REVEAL_PIN = '246810'
const SYNTHETIC_FOLDER_NAME = 'Synthetic Local Folder'
const SYNTHETIC_SECRET_TITLE = 'Synthetic Local API Key'
const SYNTHETIC_SECRET_VALUE = 'synthetic-local-value-never-valid'
const SYNTHETIC_FIELD_KEY = 'E2E_API_KEY'
const SYNTHETIC_PROJECT_NAME = 'Synthetic Offline Project'
const PROJECT_MAPPING_FIXTURE = {
  fieldKey: SYNTHETIC_FIELD_KEY,
  projectName: SYNTHETIC_PROJECT_NAME,
  secretTitle: SYNTHETIC_SECRET_TITLE,
} as const
const PLAINTEXT_POLICY = {
  alwaysForbidden: [
    SYNTHETIC_PASSWORD,
    SYNTHETIC_SECRET_VALUE,
    SYNTHETIC_REVEAL_PIN,
    SYNTHETIC_FOLDER_NAME,
    SYNTHETIC_SECRET_TITLE,
    SYNTHETIC_PROJECT_NAME,
  ],
  auditFieldIdentifiers: [SYNTHETIC_FIELD_KEY],
} as const

export type CommunityUIE2EResult = {
  readonly checkpoints: readonly CommunityUIE2ECheckpoint[]
  readonly persistence: readonly CommunityUIE2EPersistence[]
  readonly scenarios: readonly ScenarioName[]
  readonly setupMilliseconds: number
}

type CheckboxLocator = {
  first: () => CheckboxLocator
  waitFor: (options?: { state?: 'visible'; timeout?: number }) => Promise<void>
  isChecked: () => Promise<boolean>
  check: () => Promise<void>
}
type SensitiveCheckboxDialog = {
  getByRole: (role: 'checkbox', options: { name: 'Sensitive'; exact: true }) => CheckboxLocator
}

export async function ensureSensitiveCheckboxChecked(dialog: SensitiveCheckboxDialog): Promise<void> {
  const sensitive = dialog.getByRole('checkbox', { name: 'Sensitive', exact: true }).first()
  await sensitive.waitFor({ state: 'visible', timeout: 10_000 })
  if (!(await sensitive.isChecked())) await sensitive.check()
  await expect.poll(
    async () => await sensitive.isChecked(),
    { timeout: 10_000 },
  ).toBe(true)
}

function parseScenarios(raw: string | undefined): ReadonlySet<ScenarioName> {
  if (!raw) return new Set(SCENARIO_NAMES)
  const requested = raw.split(',')
  const isScenarioName = (name: string): name is ScenarioName => (
    SCENARIO_NAMES.some(candidate => candidate === name)
  )
  if (requested.length === 0 || requested.some(name => !isScenarioName(name))) {
    throw new Error('Community E2E scenario selection is invalid')
  }
  return new Set(requested.filter(isScenarioName))
}

async function mainPage(application: ElectronApplication): Promise<Page> {
  return await application.firstWindow({ timeout: 20_000 })
}

async function dismissResearchPrompt(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: 'Skip', exact: true })
  if (await skip.isVisible().catch(() => false)) await skip.click()
}

async function captureEvidence(page: Page, environmentVariable: string): Promise<void> {
  const evidencePath = process.env[environmentVariable]
  if (evidencePath) await page.screenshot({ path: evidencePath, animations: 'disabled' })
}

async function unlockWithPassword(page: Page): Promise<void> {
  const passwordMode = page.getByRole('button', { name: 'Use master password instead' })
  await passwordMode.waitFor({ state: 'visible', timeout: 15_000 })
  await passwordMode.click()
  await page.getByPlaceholder('Master password').fill(SYNTHETIC_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await page.getByText('My Vault', { exact: true }).first().waitFor({ state: 'visible', timeout: 25_000 })
}

async function createFirstSecret(page: Page): Promise<void> {
  await page.getByText('Create your local vault', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByText('Create local vault', { exact: true }).click()
  await page.getByPlaceholder(/At least \d+ characters/u).fill(SYNTHETIC_PASSWORD)
  await page.getByPlaceholder('Repeat your password').fill(SYNTHETIC_PASSWORD)
  await page.getByRole('button', { name: 'Create Vault', exact: true }).click()
  await page.getByText('My Vault', { exact: true }).first().waitFor({ state: 'visible', timeout: 25_000 })
  await dismissResearchPrompt(page)
  await createFolderThroughDialog(page)
  await page.getByRole('button', { name: 'Secret', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('e.g. GitHub token').fill(SYNTHETIC_SECRET_TITLE)
  const field = dialog.locator('input[placeholder="Field name"]').first()
  await field.fill(SYNTHETIC_FIELD_KEY)
  await dialog.locator('input[placeholder="Value"]').first().fill(SYNTHETIC_SECRET_VALUE)
  await ensureSensitiveCheckboxChecked(dialog)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText(SYNTHETIC_SECRET_TITLE, { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 })
}

async function createFolderThroughDialog(page: Page): Promise<void> {
  await page.getByTitle('New folder').click()
  const dialog = page.getByRole('dialog', { name: 'New folder' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  const create = dialog.getByRole('button', { name: 'Create folder', exact: true })
  const folderName = dialog.getByLabel('Folder name', { exact: true })
  expect(await create.isDisabled()).toBe(true)
  await folderName.fill(`  ${SYNTHETIC_FOLDER_NAME}  `)
  expect(await create.isEnabled()).toBe(true)
  expect(await folderName.evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe('rgba(24, 26, 27, 0.72)')
  const evidencePath = process.env['VAULTAGE_COMMUNITY_E2E_DIALOG_EVIDENCE']
  if (evidencePath) await page.screenshot({ path: evidencePath, animations: 'disabled' })
  await create.click()
  await page.getByText(SYNTHETIC_FOLDER_NAME, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
}

type PersistedReveal = {
  readonly fieldId?: string
  readonly secretId: string
  readonly value: string
}

async function revealPersistedValue(page: Page): Promise<PersistedReveal> {
  await page.getByText(SYNTHETIC_SECRET_TITLE, { exact: true }).first().click()
  await page.getByText(SYNTHETIC_FIELD_KEY, { exact: true }).first().waitFor({ state: 'visible' })
  const pinButton = page.locator('main button[aria-pressed]').first()
  expect(await pinButton.getAttribute('aria-pressed')).toBe('false')
  await pinButton.click()
  await expect.poll(
    async () => await pinButton.getAttribute('aria-pressed'),
    { timeout: 10_000 },
  ).toBe('true')
  return await page.evaluate(async input => {
    const api: unknown = Reflect.get(window, 'vault')
    if (typeof api !== 'object' || api === null) throw new TypeError('Community preload API is unavailable')
    const call = async (name: string, payload: object): Promise<unknown> => {
      const method: unknown = Reflect.get(api, name)
      if (typeof method !== 'function') throw new TypeError(`Community preload method is unavailable: ${name}`)
      return await Reflect.apply(method, api, [payload])
    }
    const pinResult = await call('setRevealPin', { pin: input.pin, masterPassword: input.password })
    const pinData = typeof pinResult === 'object' && pinResult !== null ? Reflect.get(pinResult, 'data') : null
    const findSecret = (folder: unknown): object | null => {
      if (typeof folder !== 'object' || folder === null) return null
      const secrets: unknown = Reflect.get(folder, 'secrets')
      if (Array.isArray(secrets)) {
        const match = secrets.find(secret => typeof secret === 'object'
          && secret !== null
          && Reflect.get(secret, 'name') === input.title)
        if (typeof match === 'object' && match !== null) return match
      }
      const children: unknown = Reflect.get(folder, 'children')
      if (!Array.isArray(children)) return null
      for (const child of children) {
        const match = findSecret(child)
        if (match) return match
      }
      return null
    }
    const root = typeof pinData === 'object' && pinData !== null ? Reflect.get(pinData, 'root') : null
    const secret = findSecret(root)
    if (!secret || typeof Reflect.get(secret, 'id') !== 'string') throw new TypeError('Persisted secret identity is unavailable')
    const fields: unknown = Reflect.get(secret, 'fields')
    if (!Array.isArray(fields)) throw new TypeError('Persisted secret fields are unavailable')
    const field = fields.find(item => typeof item === 'object'
      && item !== null
      && Reflect.get(item, 'key') === input.fieldKey)
    if (typeof field !== 'object' || field === null) throw new TypeError('Persisted field identity is unavailable')
    const fieldId = Reflect.get(field, 'id')
    const reveal = await call('revealSecretField', {
      secretId: Reflect.get(secret, 'id'),
      fieldKey: input.fieldKey,
      ...(typeof fieldId === 'string' ? { fieldId } : {}),
      pin: input.pin,
    })
    if (typeof reveal !== 'object' || reveal === null || Reflect.get(reveal, 'success') !== true) {
      throw new Error('Persisted secret reveal failed')
    }
    const value: unknown = Reflect.get(reveal, 'value')
    if (typeof value !== 'string') throw new TypeError('Persisted secret reveal returned no value')
    const secretId = Reflect.get(secret, 'id')
    return {
      ...(typeof fieldId === 'string' ? { fieldId } : {}),
      secretId,
      value,
    }
  }, {
    fieldKey: SYNTHETIC_FIELD_KEY,
    password: SYNTHETIC_PASSWORD,
    pin: SYNTHETIC_REVEAL_PIN,
    title: SYNTHETIC_SECRET_TITLE,
  })
}

async function copyPersistedValue(
  page: Page,
  application: ElectronApplication,
  persisted: PersistedReveal,
): Promise<string> {
  const copied = await page.evaluate(async input => {
    const api: unknown = Reflect.get(window, 'vault')
    if (typeof api !== 'object' || api === null) throw new TypeError('Community preload API is unavailable')
    const method: unknown = Reflect.get(api, 'copySecretField')
    if (typeof method !== 'function') throw new TypeError('Community copy IPC is unavailable')
    return await Reflect.apply(method, api, [{
      secretId: input.secretId,
      fieldKey: input.fieldKey,
      ...(input.fieldId ? { fieldId: input.fieldId } : {}),
      pin: input.pin,
    }])
  }, {
    fieldId: persisted.fieldId,
    fieldKey: SYNTHETIC_FIELD_KEY,
    pin: SYNTHETIC_REVEAL_PIN,
    secretId: persisted.secretId,
  })
  if (typeof copied !== 'object' || copied === null || Reflect.get(copied, 'success') !== true) {
    const reason = typeof copied === 'object' && copied !== null ? Reflect.get(copied, 'error') : undefined
    throw new Error(`Persisted secret copy failed: ${String(reason ?? 'invalid response')}`)
  }
  return await readAndClearE2EClipboard(application)
}

function assertExactSyntheticValue(value: string, surface: 'copy' | 'reveal'): void {
  const digest = (candidate: string): string => createHash('sha256').update(candidate).digest('hex')
  if (digest(value) !== digest(SYNTHETIC_SECRET_VALUE)) {
    throw new Error(`Persisted ${surface} exact-value assertion failed`)
  }
}

export async function runCommunityUIE2EHappyPath(rawScenarios: string | undefined): Promise<CommunityUIE2EResult> {
  const selected = parseScenarios(rawScenarios)
  const resources = await createCommunityUIE2EResources()
  const checkpoints: CommunityUIE2ECheckpoint[] = []
  const persistence: CommunityUIE2EPersistence[] = []
  let application: ElectronApplication | null = null
  try {
    const started = Date.now()
    application = await launchCommunityUIE2E(resources)
    let page = await mainPage(application)
    checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'setup-before-mutation'))
    await createFirstSecret(page)
    const setupMilliseconds = Date.now() - started
    await captureEvidence(page, 'VAULTAGE_COMMUNITY_E2E_VAULT_EVIDENCE')
    checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'setup-complete'))
    if (selected.has('sidebar-drag-drop')) {
      await verifyCommunitySidebarSecretDragDrop(page)
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'sidebar-drag-drop-complete'))
    }
    if (selected.has('secret-context')) {
      await verifyCommunitySecretContext(page)
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'secret-context-complete'))
    }
    if (selected.has('vault-controls')) {
      await verifyCommunityVaultControls(page)
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'vault-controls-complete'))
    }

    if (selected.has('persistence') || selected.has('project-mapping')) {
      application = await closeCommunityUIE2E(application)
      application = await launchCommunityUIE2E(resources)
      page = await mainPage(application)
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'restart-before-auth'))
      await unlockWithPassword(page)
    }
    if (selected.has('persistence') && application) {
      const revealed = await revealPersistedValue(page)
      assertExactSyntheticValue(revealed.value, 'reveal')
      assertExactSyntheticValue(await copyPersistedValue(page, application, revealed), 'copy')
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'persistence-reveal-copy'))
    }
    if (selected.has('persistence') && selected.has('project-mapping') && application) {
      application = await closeCommunityUIE2E(application)
      application = await launchCommunityUIE2E(resources)
      page = await mainPage(application)
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'mapping-before-auth'))
      await unlockWithPassword(page)
    }
    if (selected.has('project-mapping') && application) {
      await page.getByRole('button', { name: 'Projects', exact: true }).first().click()
      await page.getByText('Local Project Mappings', { exact: true }).waitFor({ state: 'visible' })
      await captureEvidence(page, 'VAULTAGE_COMMUNITY_E2E_PROJECTS_DASHBOARD_EVIDENCE')
      await installProjectFolderDialog(application, resources.run.projectDir)
      await createProjectMapping(page, PROJECT_MAPPING_FIXTURE)
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'project-mapping-created'))
      application = await closeCommunityUIE2E(application)
      application = await launchCommunityUIE2E(resources)
      page = await mainPage(application)
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'mapping-restart-before-auth'))
      await unlockWithPassword(page)
      await page.getByRole('button', { name: 'Projects', exact: true }).first().click()
      await assertExactProjectMapping(page, PROJECT_MAPPING_FIXTURE)
      await verifyCommunityProjectPin(page)
      await captureEvidence(page, 'VAULTAGE_COMMUNITY_E2E_PROJECTS_EVIDENCE')
      checkpoints.push(await assertCommunityUIE2ECheckpoint(application, page, resources, 'mapping-restart-ready'))
    }
    application = await closeCommunityUIE2E(application)
    persistence.push(assertEncryptedCommunityProfile(resources.run, PLAINTEXT_POLICY))
    return { checkpoints, persistence, scenarios: [...selected], setupMilliseconds }
  } finally {
    await cleanupCommunityUIE2EResources(application, resources)
  }
}
