import { existsSync, rmSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type { CommunityPolicySentinel } from './communityPolicyE2ESentinel'
import {
  enumerateProcessTable,
  type CommunityUIE2EProcessOwnership,
} from './communityUIE2EProcessOwnership'
import {
  cleanupOwnedProcesses,
  type CommunityPolicyCleanupSignal,
  type CommunityPolicyProcessCleanupDependencies,
  type CommunityPolicyProcessCleanupStage,
} from './communityUIE2EProcessCleanup'
import {
  assertCommunityUIE2ERunToken,
  enumerateCommunityUIE2ERunProcesses,
} from './communityUIE2ERunProcessOwnership'

const RUN_ROOT_PREFIX = 'vaultage-policy-'
export type { CommunityPolicyCleanupSignal } from './communityUIE2EProcessCleanup'

export type CommunityPolicyRun = {
  readonly root: string
  readonly ownedParent: string
  readonly profileDir: string
}

export type CommunityPolicyApplication = {
  readonly close: () => Promise<void>
}

export type CommunityPolicyCleanupRequest = {
  readonly application: CommunityPolicyApplication | null
  readonly processOwnership: CommunityUIE2EProcessOwnership
  readonly run: CommunityPolicyRun
  readonly sentinels: readonly CommunityPolicySentinel[]
}

export type CommunityPolicyCleanupStage =
  | CommunityPolicyProcessCleanupStage
  | 'owned-root-validation'
  | 'application-close'
  | 'sentinel-close'
  | 'run-root-delete'
  | 'run-root-absence'

export type CommunityPolicyCleanupDependencies = CommunityPolicyProcessCleanupDependencies & {
  readonly closeApplication: (application: CommunityPolicyApplication) => Promise<void>
  readonly removeRoot: (root: string) => void
  readonly rootExists: (root: string) => boolean
}

export class CommunityPolicyCloseTimeoutError extends Error {
  readonly name = 'CommunityPolicyCloseTimeoutError'

  constructor() {
    super('Electron policy close timed out')
  }
}

export class CommunityPolicyOwnedRootError extends Error {
  readonly name = 'CommunityPolicyOwnedRootError'

  constructor() {
    super('Community policy run root is not an exact owned child')
  }
}

export class CommunityPolicyRootResidueError extends Error {
  readonly name = 'CommunityPolicyRootResidueError'

  constructor() {
    super('Community policy run root still exists after deletion')
  }
}

export class CommunityPolicyCleanupStepError extends Error {
  readonly name = 'CommunityPolicyCleanupStepError'

  constructor(
    readonly stage: CommunityPolicyCleanupStage,
    cause: unknown,
  ) {
    super(`Community policy cleanup failed at ${stage}`, { cause })
  }
}

export class CommunityPolicyCleanupError extends AggregateError {
  readonly name = 'CommunityPolicyCleanupError'
  readonly stages: readonly CommunityPolicyCleanupStage[]

  constructor(errors: readonly CommunityPolicyCleanupStepError[]) {
    super(errors, 'Community policy cleanup failed')
    this.stages = errors.map(error => error.stage)
  }
}

function assertOwnedRun(run: CommunityPolicyRun): { readonly root: string; readonly runToken: string } {
  const ownedParent = resolve(run.ownedParent)
  const root = resolve(run.root)
  const name = basename(root)
  const isExactOwnedChild = run.ownedParent === ownedParent
    && run.root === root
    && dirname(root) === ownedParent
    && name.startsWith(RUN_ROOT_PREFIX)
    && name.length > RUN_ROOT_PREFIX.length
    && run.profileDir === join(root, 'profile')
  if (!isExactOwnedChild) throw new CommunityPolicyOwnedRootError()
  assertCommunityUIE2ERunToken(name)
  return { root, runToken: name }
}

function killPid(pid: number, signal: CommunityPolicyCleanupSignal): void {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return
    throw error
  }
}

async function closeApplication(application: CommunityPolicyApplication): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      application.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CommunityPolicyCloseTimeoutError()), 5_000)
      }),
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

export const COMMUNITY_POLICY_CLEANUP_DEPENDENCIES = {
  closeApplication,
  enumerateProcesses: enumerateProcessTable,
  enumerateRunProcesses: enumerateCommunityUIE2ERunProcesses,
  killPid,
  waitForProcessExit: async () => await new Promise<void>(resolveWait => {
    setTimeout(resolveWait, 100)
  }),
  removeRoot: root => rmSync(root, { recursive: true, force: true }),
  rootExists: existsSync,
} satisfies CommunityPolicyCleanupDependencies

export async function cleanupCommunityPolicyResources(
  request: CommunityPolicyCleanupRequest,
  dependencies: CommunityPolicyCleanupDependencies = COMMUNITY_POLICY_CLEANUP_DEPENDENCIES,
): Promise<void> {
  const failures: CommunityPolicyCleanupStepError[] = []
  const recordFailure = (stage: CommunityPolicyCleanupStage, cause: unknown): void => {
    failures.push(new CommunityPolicyCleanupStepError(stage, cause))
  }
  const attempt = async (
    stage: CommunityPolicyCleanupStage,
    operation: () => Promise<void>,
  ): Promise<void> => {
    try {
      await operation()
    } catch (error) {
      recordFailure(stage, error instanceof Error ? error : new TypeError('Cleanup adapter threw a non-Error value'))
    }
  }

  let ownedRun: { readonly root: string; readonly runToken: string } | null = null
  try {
    ownedRun = assertOwnedRun(request.run)
  } catch (error) {
    recordFailure('owned-root-validation', error instanceof Error ? error : new TypeError('Root validation threw a non-Error value'))
  }

  const application = request.application
  if (application) {
    await attempt('application-close', async () => {
      await dependencies.closeApplication(application)
    })
  }

  if (ownedRun !== null) {
    const processFailures = await cleanupOwnedProcesses({
      ownership: request.processOwnership,
      runToken: ownedRun.runToken,
    }, dependencies)
    for (const failure of processFailures) recordFailure(failure.stage, failure.cause)
  }

  for (const sentinel of request.sentinels) {
    await attempt('sentinel-close', sentinel.close)
  }

  if (ownedRun !== null) {
    const root = ownedRun.root
    let retryDeletion = false
    try {
      dependencies.removeRoot(root)
    } catch (error) {
      recordFailure('run-root-delete', error instanceof Error ? error : new TypeError('Root deletion threw a non-Error value'))
      retryDeletion = true
    }
    try {
      retryDeletion = dependencies.rootExists(root) || retryDeletion
    } catch (error) {
      recordFailure('run-root-absence', error instanceof Error ? error : new TypeError('Root absence check threw a non-Error value'))
      retryDeletion = true
    }
    if (retryDeletion) {
      try {
        dependencies.removeRoot(root)
      } catch (error) {
        recordFailure('run-root-delete', error instanceof Error ? error : new TypeError('Root deletion retry threw a non-Error value'))
      }
      try {
        if (dependencies.rootExists(root)) {
          recordFailure('run-root-absence', new CommunityPolicyRootResidueError())
        }
      } catch (error) {
        recordFailure('run-root-absence', error instanceof Error ? error : new TypeError('Final root absence check threw a non-Error value'))
      }
    }
  }

  if (failures.length > 0) throw new CommunityPolicyCleanupError(failures)
}
