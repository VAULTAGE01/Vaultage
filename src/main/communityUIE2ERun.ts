import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { createRequire } from 'node:module'
import { basename, join } from 'path'
import type { ElectronApplication } from 'playwright-core'
import { createE2EChildEnvironment } from './e2eHeadlessPolicy'
import {
  COMMUNITY_POLICY_CLEANUP_DEPENDENCIES,
  cleanupCommunityPolicyResources,
  type CommunityPolicyCleanupDependencies,
  type CommunityPolicyRun,
} from './communityPolicyE2EResources'
import {
  COMMUNITY_POLICY_PROTOCOLS,
  startCommunityPolicySentinel,
  type CommunityPolicySentinel,
} from './communityPolicyE2ESentinel'
import { CommunityUIE2EProcessTracker } from './communityUIE2EProcessOwnership'

const PROJECT_ROOT = realpathSync(process.cwd())
const BUILT_OUT = join(PROJECT_ROOT, 'out')
const EXPECTED_SOURCE_ROOT = process.env['VAULTAGE_COMMUNITY_E2E_EXPECTED_SOURCE_ROOT']
const EXPECTED_APP_ROOT = process.env['VAULTAGE_COMMUNITY_E2E_EXPECTED_APP_ROOT']
const EXPECTED_BUILD_MANIFEST = process.env['VAULTAGE_COMMUNITY_E2E_BUILD_MANIFEST']
const ELECTRON_EXECUTABLE = resolveElectronExecutable()
const ACTIVE_RESOURCES = new Map<string, CommunityUIE2EResources>()
let cleanupFaultConsumed = false

class CommunityUIE2ECleanupFaultError extends Error {
  readonly name = 'CommunityUIE2ECleanupFaultError'

  constructor(readonly fault: string) {
    super(`Community UI E2E cleanup fault injected: ${fault}`)
  }
}

function cleanupDependencies(): CommunityPolicyCleanupDependencies {
  const fault = process.env['VAULTAGE_COMMUNITY_E2E_CLEANUP_FAULT']
  if (fault === undefined || cleanupFaultConsumed) return COMMUNITY_POLICY_CLEANUP_DEPENDENCIES
  cleanupFaultConsumed = true
  if (fault === 'enumeration') {
    return {
      ...COMMUNITY_POLICY_CLEANUP_DEPENDENCIES,
      enumerateProcesses: () => { throw new CommunityUIE2ECleanupFaultError(fault) },
    }
  }
  if (fault === 'deletion') {
    return {
      ...COMMUNITY_POLICY_CLEANUP_DEPENDENCIES,
      removeRoot: () => { throw new CommunityUIE2ECleanupFaultError(fault) },
    }
  }
  throw new CommunityUIE2ECleanupFaultError('invalid')
}

export type CommunityUIE2ERun = CommunityPolicyRun & {
  readonly alternateProjectDir: string
  readonly appRoot: string
  readonly homeDir: string
  readonly manualScanFile: string
  readonly projectDir: string
  readonly tmpDir: string
}

export type CommunityUIE2EResources = {
  readonly processTracker: CommunityUIE2EProcessTracker
  readonly run: CommunityUIE2ERun
  readonly sentinels: readonly CommunityPolicySentinel[]
}

function resolveElectronExecutable(): string {
  const executable: unknown = createRequire(join(PROJECT_ROOT, 'package.json'))('electron')
  if (typeof executable !== 'string') throw new TypeError('Electron executable is unavailable')
  return executable
}

function requireRunnerInputs(): string {
  if (!EXPECTED_SOURCE_ROOT || !EXPECTED_APP_ROOT || !EXPECTED_BUILD_MANIFEST) {
    throw new Error('Community E2E runner inputs are missing')
  }
  if (realpathSync(EXPECTED_SOURCE_ROOT) !== PROJECT_ROOT || !existsSync(EXPECTED_BUILD_MANIFEST)) {
    throw new Error('Community E2E runner inputs do not match the source or build manifest')
  }
  if (!existsSync(join(BUILT_OUT, 'main', 'index.js'))) {
    throw new Error('Fresh Community build output is unavailable')
  }
  return realpathSync(EXPECTED_APP_ROOT)
}

function createRun(): CommunityUIE2ERun {
  const ownedParent = requireRunnerInputs()
  const root = mkdtempSync(join(ownedParent, 'vaultage-policy-'))
  const appRoot = join(root, 'app')
  const alternateProjectDir = join(root, 'alternate-project')
  const homeDir = join(root, 'home')
  const profileDir = join(root, 'profile')
  const projectDir = join(root, 'project')
  const manualScanFile = join(projectDir, 'manual.config')
  const tmpDir = join(root, 'tmp')
  mkdirSync(join(appRoot, 'resources'), { recursive: true, mode: 0o700 })
  mkdirSync(alternateProjectDir, { mode: 0o700 })
  mkdirSync(homeDir, { mode: 0o700 })
  mkdirSync(profileDir, { mode: 0o700 })
  mkdirSync(projectDir, { mode: 0o700 })
  mkdirSync(tmpDir, { mode: 0o700 })
  cpSync(BUILT_OUT, join(appRoot, 'out'), { recursive: true })
  cpSync(join(PROJECT_ROOT, 'resources', 'icon.icns'), join(appRoot, 'resources', 'icon.icns'))
  writeFileSync(join(appRoot, 'package.json'), JSON.stringify({
    name: 'vaultage-community-e2e',
    version: '0.0.0',
    main: 'out/main/index.js',
  }), { mode: 0o600 })
  writeFileSync(
    join(projectDir, 'index.ts'),
    'export const configured = process.env.E2E_API_KEY\n',
    { mode: 0o600 },
  )
  writeFileSync(manualScanFile, 'E2E_MANUAL_KEY=synthetic\n', { mode: 0o600 })
  return {
    root,
    ownedParent,
    alternateProjectDir,
    appRoot,
    homeDir,
    manualScanFile,
    profileDir,
    projectDir,
    tmpDir,
  }
}

export async function createCommunityUIE2EResources(): Promise<CommunityUIE2EResources> {
  const run = createRun()
  const sentinels: CommunityPolicySentinel[] = []
  const resources = { processTracker: new CommunityUIE2EProcessTracker(), run, sentinels }
  ACTIVE_RESOURCES.set(run.root, resources)
  try {
    for (const protocol of COMMUNITY_POLICY_PROTOCOLS) {
      sentinels.push(await startCommunityPolicySentinel(protocol))
    }
    return resources
  } catch (error) {
    await cleanupCommunityUIE2EResources(null, resources)
    throw error
  }
}

export async function launchCommunityUIE2E(resources: CommunityUIE2EResources): Promise<ElectronApplication> {
  const run = resources.run
  const path = process.env['PATH']
  if (!path) throw new Error('Community E2E requires PATH')
  const { _electron } = await import('playwright-core')
  const application = await _electron.launch({
    executablePath: ELECTRON_EXECUTABLE,
    args: [run.appRoot, `--user-data-dir=${run.profileDir}`],
    cwd: run.appRoot,
    env: createE2EChildEnvironment({
      path,
      home: run.homeDir,
      tmpDir: run.tmpDir,
      runId: basename(run.root),
      evidenceId: 'task-7-community-happy-path',
      lang: 'en_US.UTF-8',
      lcAll: 'en_US.UTF-8',
      ci: '1',
      nodeEnv: 'test',
    }),
    timeout: 30_000,
  })
  const rootPid = application.process().pid
  if (rootPid === undefined) throw new Error('Community E2E Electron root PID is unavailable')
  resources.processTracker.recordRoot(rootPid)
  return application
}

export async function closeCommunityUIE2E(application: ElectronApplication): Promise<null> {
  await application.close()
  return null
}

export async function installProjectFolderDialog(
  application: ElectronApplication,
  projectDir: string,
): Promise<void> {
  await application.evaluate(({ dialog }, pickerPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pickerPath] })
  }, projectDir)
}

export async function installRecoveryKitSaveDialog(
  application: ElectronApplication,
  tmpDir: string,
): Promise<void> {
  await application.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
  }, join(tmpDir, 'Vaultage-Emergency-Kit.pdf'))
}

export async function cleanupCommunityUIE2EResources(
  application: ElectronApplication | null,
  resources: CommunityUIE2EResources,
): Promise<void> {
  await cleanupCommunityPolicyResources({
    application,
    processOwnership: resources.processTracker.snapshot(),
    run: resources.run,
    sentinels: resources.sentinels,
  }, cleanupDependencies())
  ACTIVE_RESOURCES.delete(resources.run.root)
}

export async function cleanupAllCommunityUIE2EResources(): Promise<void> {
  const failures: Error[] = []
  for (const resources of ACTIVE_RESOURCES.values()) {
    try {
      await cleanupCommunityUIE2EResources(null, resources)
    } catch (error) {
      failures.push(error instanceof Error ? error : new TypeError('Community E2E cleanup failed'))
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Community E2E cleanup backstop failed')
}
