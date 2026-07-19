import { describe, expect, it } from 'vitest'
import {
  cleanupOwnedProcesses,
  type CommunityPolicyCleanupSignal,
  type CommunityPolicyProcessCleanupDependencies,
  type CommunityPolicyProcessCleanupRequest,
} from './communityUIE2EProcessCleanup'
import type {
  CommunityUIE2EProcessIdentity,
  CommunityUIE2EProcessRecord,
} from './communityUIE2EProcessOwnership'

const START_A = 'Sat Jul 18 10:00:00 2026'
const START_B = 'Sat Jul 18 10:00:01 2026'
const RUN_TOKEN = 'vaultage-policy-fixture'

function identity(pid: number, startToken = START_A): CommunityUIE2EProcessIdentity {
  return { pid, startToken }
}

function record(
  pid: number,
  parentPid: number,
  startToken = START_A,
): CommunityUIE2EProcessRecord {
  return { parentPid, pid, startToken }
}

function cleanupRequest(
  roots: readonly CommunityUIE2EProcessIdentity[],
  observed = roots,
): CommunityPolicyProcessCleanupRequest {
  return {
    ownership: { rootIdentities: roots, observedIdentities: observed },
    runToken: RUN_TOKEN,
  }
}

describe('Community UI E2E cleanup ownership', () => {
  it('never signals a reused PID carrying a different start token', async () => {
    // Given
    const signals: Array<{ readonly pid: number; readonly signal: CommunityPolicyCleanupSignal }> = []
    const dependencies = {
      enumerateProcesses: () => [record(101, 1, START_B)],
      enumerateRunProcesses: () => ({ processes: [record(101, 1, START_B)], runProcesses: [] }),
      killPid: (pid, signal) => { signals.push({ pid, signal }) },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies

    // When
    const failures = await cleanupOwnedProcesses(cleanupRequest([identity(101)]), dependencies)

    // Then
    expect(signals).toEqual([])
    expect(failures).toEqual([])
  })

  it('signals the same PID when the immutable start token still matches', async () => {
    // Given
    const signals: Array<{ readonly pid: number; readonly signal: CommunityPolicyCleanupSignal }> = []
    let current: readonly CommunityUIE2EProcessRecord[] = [record(101, 1)]
    const dependencies = {
      enumerateProcesses: () => current,
      enumerateRunProcesses: () => ({ processes: current, runProcesses: current }),
      killPid: (pid, signal) => {
        signals.push({ pid, signal })
        current = []
      },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies

    // When
    const failures = await cleanupOwnedProcesses(cleanupRequest([identity(101)]), dependencies)

    // Then
    expect(signals).toEqual([{ pid: 101, signal: 'SIGTERM' }])
    expect(failures).toEqual([])
  })

  it('preserves an observed descendant identity after PPID reparenting', async () => {
    // Given
    const signals: Array<{ readonly pid: number; readonly signal: CommunityPolicyCleanupSignal }> = []
    let current: readonly CommunityUIE2EProcessRecord[] = [record(102, 1)]
    const dependencies = {
      enumerateProcesses: () => current,
      enumerateRunProcesses: () => ({ processes: current, runProcesses: current }),
      killPid: (pid, signal) => {
        signals.push({ pid, signal })
        current = []
      },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies
    const tracked = cleanupRequest([identity(101)], [identity(101), identity(102)])

    // When
    const failures = await cleanupOwnedProcesses(tracked, dependencies)

    // Then
    expect(signals).toEqual([{ pid: 102, signal: 'SIGTERM' }])
    expect(failures).toEqual([])
  })

  it('excludes unrelated identities while terminating exact descendants', async () => {
    // Given
    const signals: Array<{ readonly pid: number; readonly signal: CommunityPolicyCleanupSignal }> = []
    let current: readonly CommunityUIE2EProcessRecord[] = [
      record(101, 1),
      record(102, 101),
      record(900, 1),
    ]
    const dependencies = {
      enumerateProcesses: () => current,
      enumerateRunProcesses: () => ({
        processes: current,
        runProcesses: current.filter(processRecord => processRecord.pid !== 900),
      }),
      killPid: (pid, signal) => {
        signals.push({ pid, signal })
        current = current.filter(processRecord => processRecord.pid !== pid)
      },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies

    // When
    const failures = await cleanupOwnedProcesses(cleanupRequest([identity(101)]), dependencies)

    // Then
    expect(signals).toEqual([
      { pid: 101, signal: 'SIGTERM' },
      { pid: 102, signal: 'SIGTERM' },
    ])
    expect(failures).toEqual([])
  })

  it('records enumeration failure without signaling unverified historical identities', async () => {
    // Given
    const signals: number[] = []
    const dependencies = {
      enumerateProcesses: () => { throw new Error('synthetic enumeration failure') },
      enumerateRunProcesses: () => ({ processes: [], runProcesses: [] }),
      killPid: pid => { signals.push(pid) },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies

    // When
    const failures = await cleanupOwnedProcesses(
      cleanupRequest([identity(101)], [identity(101), identity(102)]),
      dependencies,
    )

    // Then
    expect(signals).toEqual([])
    expect(failures.map(failure => failure.stage)).toEqual([
      'process-enumeration-SIGTERM',
      'process-enumeration-SIGKILL',
      'process-enumeration-final',
      'process-liveness-final',
    ])
  })
})
