import {
  matchingProcessIdentities,
  ownedProcessIdentities,
  type CommunityUIE2EProcessIdentity,
  type CommunityUIE2EProcessOwnership,
  type CommunityUIE2EProcessRecord,
} from './communityUIE2EProcessOwnership'
import type { CommunityUIE2ERunProcessSnapshot } from './communityUIE2ERunProcessOwnership'

const PROCESS_SIGNALS = ['SIGTERM', 'SIGKILL'] as const

export type CommunityPolicyCleanupSignal = (typeof PROCESS_SIGNALS)[number]

export type CommunityPolicyProcessCleanupStage =
  | 'process-enumeration-SIGTERM'
  | 'process-kill-SIGTERM'
  | 'process-wait-SIGTERM'
  | 'process-enumeration-SIGKILL'
  | 'process-kill-SIGKILL'
  | 'process-wait-SIGKILL'
  | 'process-enumeration-final'
  | 'process-liveness-SIGTERM'
  | 'process-liveness-SIGKILL'
  | 'process-liveness-final'
  | 'process-run-enumeration-SIGTERM'
  | 'process-run-liveness-SIGTERM'
  | 'process-run-enumeration-SIGKILL'
  | 'process-run-liveness-SIGKILL'
  | 'process-run-enumeration-final'
  | 'process-run-liveness-final'
  | 'process-residue'

export type CommunityPolicyProcessCleanupDependencies = {
  readonly enumerateProcesses: () => readonly CommunityUIE2EProcessRecord[]
  readonly enumerateRunProcesses: (runToken: string) => CommunityUIE2ERunProcessSnapshot
  readonly killPid: (pid: number, signal: CommunityPolicyCleanupSignal) => void
  readonly waitForProcessExit: () => Promise<void>
}

export type CommunityPolicyProcessCleanupRequest = {
  readonly ownership: CommunityUIE2EProcessOwnership
  readonly runToken: string
}

export type CommunityPolicyProcessCleanupFailure = {
  readonly cause: Error
  readonly stage: CommunityPolicyProcessCleanupStage
}

export class CommunityPolicyProcessResidueError extends Error {
  readonly name = 'CommunityPolicyProcessResidueError'

  constructor(readonly count: number) {
    super('Community policy process cleanup left owned processes')
  }
}

export class CommunityPolicyProcessRunOwnershipError extends Error {
  readonly name = 'CommunityPolicyProcessRunOwnershipError'

  constructor() {
    super('Community policy process no longer has exact run ownership')
  }
}

function identityKey(identity: CommunityUIE2EProcessIdentity): string {
  return `${identity.pid}\u0000${identity.startToken}`
}

function addIdentities(
  observed: Map<string, CommunityUIE2EProcessIdentity>,
  identities: readonly CommunityUIE2EProcessIdentity[],
): void {
  for (const identity of identities) observed.set(identityKey(identity), identity)
}

export async function cleanupOwnedProcesses(
  request: CommunityPolicyProcessCleanupRequest,
  dependencies: CommunityPolicyProcessCleanupDependencies,
): Promise<readonly CommunityPolicyProcessCleanupFailure[]> {
  const ownership = request.ownership
  if (ownership.rootIdentities.length === 0) return []
  const failures: CommunityPolicyProcessCleanupFailure[] = []
  const observed = new Map(
    ownership.observedIdentities.map(identity => [identityKey(identity), identity]),
  )

  for (const signal of PROCESS_SIGNALS) {
    let directEnumerationSucceeded = false
    let runEnumerationSucceeded = false
    try {
      const discovered = ownedProcessIdentities(
        ownership.rootIdentities,
        dependencies.enumerateProcesses(),
      )
      addIdentities(observed, discovered)
      directEnumerationSucceeded = true
    } catch (error) {
      failures.push({
        cause: error instanceof Error
          ? error
          : new TypeError('Process enumeration threw a non-Error value'),
        stage: `process-enumeration-${signal}`,
      })
    }
    try {
      const snapshot = dependencies.enumerateRunProcesses(request.runToken)
      addIdentities(observed, snapshot.runProcesses)
      runEnumerationSucceeded = true
    } catch (error) {
      failures.push({
        cause: error instanceof Error
          ? error
          : new TypeError('Run process enumeration threw a non-Error value'),
        stage: `process-run-enumeration-${signal}`,
      })
    }

    if (directEnumerationSucceeded && runEnumerationSucceeded) {
      for (const identity of observed.values()) {
        let isCurrent = false
        try {
          isCurrent = matchingProcessIdentities(
            [identity],
            dependencies.enumerateProcesses(),
          ).length === 1
        } catch (error) {
          failures.push({
            cause: error instanceof Error
              ? error
              : new TypeError('Process revalidation threw a non-Error value'),
            stage: `process-liveness-${signal}`,
          })
        }
        if (!isCurrent) continue
        let hasExactRunToken = false
        try {
          const snapshot = dependencies.enumerateRunProcesses(request.runToken)
          const current = matchingProcessIdentities([identity], snapshot.processes)
          const exactRun = matchingProcessIdentities([identity], snapshot.runProcesses)
          hasExactRunToken = current.length === 1 && exactRun.length === 1
          if (current.length === 1 && exactRun.length === 0) {
            throw new CommunityPolicyProcessRunOwnershipError()
          }
        } catch (error) {
          failures.push({
            cause: error instanceof Error
              ? error
              : new TypeError('Run process revalidation threw a non-Error value'),
            stage: `process-run-liveness-${signal}`,
          })
        }
        if (!hasExactRunToken) continue
        try {
          dependencies.killPid(identity.pid, signal)
        } catch (error) {
          failures.push({
            cause: error instanceof Error
              ? error
              : new TypeError('PID termination threw a non-Error value'),
            stage: `process-kill-${signal}`,
          })
        }
      }
    }

    try {
      await dependencies.waitForProcessExit()
    } catch (error) {
      failures.push({
        cause: error instanceof Error
          ? error
          : new TypeError('Process wait threw a non-Error value'),
        stage: `process-wait-${signal}`,
      })
    }
  }

  try {
    const discovered = ownedProcessIdentities(
      ownership.rootIdentities,
      dependencies.enumerateProcesses(),
    )
    addIdentities(observed, discovered)
  } catch (error) {
    failures.push({
      cause: error instanceof Error
        ? error
        : new TypeError('Final process enumeration threw a non-Error value'),
      stage: 'process-enumeration-final',
    })
  }

  try {
    const snapshot = dependencies.enumerateRunProcesses(request.runToken)
    addIdentities(observed, snapshot.runProcesses)
  } catch (error) {
    failures.push({
      cause: error instanceof Error
        ? error
        : new TypeError('Final run process enumeration threw a non-Error value'),
      stage: 'process-run-enumeration-final',
    })
  }

  try {
    dependencies.enumerateProcesses()
  } catch (error) {
    failures.push({
      cause: error instanceof Error
        ? error
        : new TypeError('Final process revalidation threw a non-Error value'),
      stage: 'process-liveness-final',
    })
  }

  try {
    const snapshot = dependencies.enumerateRunProcesses(request.runToken)
    const observedIdentities = [...observed.values()]
    const current = matchingProcessIdentities(observedIdentities, snapshot.processes)
    const exactRun = matchingProcessIdentities(observedIdentities, snapshot.runProcesses)
    if (current.length !== exactRun.length) {
      failures.push({
        cause: new CommunityPolicyProcessRunOwnershipError(),
        stage: 'process-run-liveness-final',
      })
    }
    if (snapshot.runProcesses.length > 0) {
      failures.push({
        cause: new CommunityPolicyProcessResidueError(snapshot.runProcesses.length),
        stage: 'process-residue',
      })
    }
  } catch (error) {
    failures.push({
      cause: error instanceof Error
        ? error
        : new TypeError('Final run process revalidation threw a non-Error value'),
      stage: 'process-run-liveness-final',
    })
  }

  return failures
}
