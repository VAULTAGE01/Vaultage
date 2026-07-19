import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import type { ElectronApplication } from 'playwright-core'
import { createE2EChildEnvironment } from './e2eHeadlessPolicy'
import {
  cleanupCommunityPolicyResources,
  type CommunityPolicyRun,
} from './communityPolicyE2EResources'
import type { CommunityPolicySentinel } from './communityPolicyE2ESentinel'
import { CommunityUIE2EProcessTracker } from './communityUIE2EProcessOwnership'

const PROJECT_ROOT = realpathSync(process.cwd())
const BUILT_OUT = join(PROJECT_ROOT, 'out')
const EXPECTED_APP_ROOT = process.env['VAULTAGE_COMMUNITY_E2E_EXPECTED_APP_ROOT']
const ELECTRON_EXECUTABLE = resolveElectronExecutable()
const ACTIVE_RUNS = new Map<string, CommunityUIE2EPolicyRun>()

export type CommunityUIE2EPolicyRun = CommunityPolicyRun & {
  readonly appRoot: string
  readonly homeDir: string
  readonly processTracker: CommunityUIE2EProcessTracker
  readonly tmpDir: string
}

function resolveElectronExecutable(): string {
  const executable: unknown = createRequire(join(PROJECT_ROOT, 'package.json'))('electron')
  if (typeof executable !== 'string') throw new TypeError('Electron executable is unavailable')
  return executable
}

export function createCommunityUIE2EPolicyRun(): CommunityUIE2EPolicyRun {
  if (!EXPECTED_APP_ROOT || !existsSync(BUILT_OUT)) {
    throw new Error('Fresh Community E2E runner inputs are unavailable')
  }
  const ownedParent = realpathSync(EXPECTED_APP_ROOT)
  const root = mkdtempSync(join(ownedParent, 'vaultage-policy-'))
  const appRoot = join(root, 'app')
  const homeDir = join(root, 'home')
  const profileDir = join(root, 'profile')
  const tmpDir = join(root, 'tmp')
  const run = {
    root,
    ownedParent,
    appRoot,
    homeDir,
    processTracker: new CommunityUIE2EProcessTracker(),
    profileDir,
    tmpDir,
  }
  ACTIVE_RUNS.set(root, run)
  mkdirSync(join(appRoot, 'resources'), { recursive: true, mode: 0o700 })
  mkdirSync(homeDir, { mode: 0o700 })
  mkdirSync(profileDir, { mode: 0o700 })
  mkdirSync(tmpDir, { mode: 0o700 })
  cpSync(BUILT_OUT, join(appRoot, 'out'), { recursive: true })
  cpSync(join(PROJECT_ROOT, 'resources', 'icon.icns'), join(appRoot, 'resources', 'icon.icns'))
  writeFileSync(join(appRoot, 'package.json'), JSON.stringify({
    name: 'vaultage-community-policy-e2e',
    version: '0.0.0',
    main: 'out/main/index.js',
  }), { mode: 0o600 })
  return run
}

export async function launchCommunityUIE2EPolicyRun(
  run: CommunityUIE2EPolicyRun,
): Promise<ElectronApplication> {
  const path = process.env['PATH']
  if (!path) throw new Error('Community policy E2E requires PATH')
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
      evidenceId: 'task-8-policy',
      lang: 'en_US.UTF-8',
      lcAll: 'en_US.UTF-8',
      ci: '1',
      nodeEnv: 'test',
    }),
    timeout: 30_000,
  })
  const rootPid = application.process().pid
  if (rootPid === undefined) throw new Error('Community policy Electron root PID is unavailable')
  run.processTracker.recordRoot(rootPid)
  return application
}

export async function cleanupCommunityUIE2EPolicyRun(
  application: ElectronApplication | null,
  run: CommunityUIE2EPolicyRun,
  sentinels: readonly CommunityPolicySentinel[],
): Promise<void> {
  await cleanupCommunityPolicyResources({
    application,
    processOwnership: run.processTracker.snapshot(),
    run,
    sentinels,
  })
  ACTIVE_RUNS.delete(run.root)
}

export async function cleanupAllCommunityUIE2EPolicyRuns(): Promise<void> {
  const failures: Error[] = []
  for (const run of ACTIVE_RUNS.values()) {
    try {
      await cleanupCommunityUIE2EPolicyRun(null, run, [])
    } catch (error) {
      failures.push(error instanceof Error ? error : new TypeError('Community policy cleanup failed'))
    }
  }
  if (ACTIVE_RUNS.size > 0) failures.push(new Error('Community policy cleanup left active runs'))
  if (failures.length > 0) throw new AggregateError(failures, 'Community policy cleanup backstop failed')
}
