import { describe, expect, it } from 'vitest'
import {
  cleanupOwnedProcesses,
  type CommunityPolicyProcessCleanupDependencies,
  type CommunityPolicyProcessCleanupRequest,
} from './communityUIE2EProcessCleanup'
import type { CommunityUIE2EProcessRecord } from './communityUIE2EProcessOwnership'
import { CommunityUIE2ERunProcessEnumerationError } from './communityUIE2ERunProcessOwnership'

const START = 'Sat Jul 18 10:00:00 2026'
const RUN_TOKEN = 'vaultage-policy-fixture'
const ROOT = { pid: 101, startToken: START }
const REQUEST = {
  ownership: { rootIdentities: [ROOT], observedIdentities: [ROOT] },
  runToken: RUN_TOKEN,
} satisfies CommunityPolicyProcessCleanupRequest

function record(): CommunityUIE2EProcessRecord {
  return { parentPid: 1, ...ROOT }
}

describe('Community UI E2E run cleanup safety', () => {
  it('fails closed without signaling when run-token enumeration fails', async () => {
    // Given
    const signals: number[] = []
    const current = [record()]
    const dependencies = {
      enumerateProcesses: () => current,
      enumerateRunProcesses: () => { throw new CommunityUIE2ERunProcessEnumerationError() },
      killPid: pid => { signals.push(pid) },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies

    // When
    const failures = await cleanupOwnedProcesses(REQUEST, dependencies)

    // Then
    expect(signals).toEqual([])
    expect(failures.map(failure => failure.stage)).toEqual([
      'process-run-enumeration-SIGTERM',
      'process-run-enumeration-SIGKILL',
      'process-run-enumeration-final',
      'process-run-liveness-final',
    ])
  })

  it('revalidates the exact run token immediately before every signal', async () => {
    // Given
    const signals: number[] = []
    const current = [record()]
    let runEnumerations = 0
    const dependencies = {
      enumerateProcesses: () => current,
      enumerateRunProcesses: () => {
        runEnumerations += 1
        return { processes: current, runProcesses: runEnumerations === 1 ? current : [] }
      },
      killPid: pid => { signals.push(pid) },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies

    // When
    const failures = await cleanupOwnedProcesses(REQUEST, dependencies)

    // Then
    expect(signals).toEqual([])
    expect(failures.map(failure => failure.stage)).toEqual([
      'process-run-liveness-SIGTERM',
      'process-run-liveness-SIGKILL',
      'process-run-liveness-final',
    ])
  })

  it('does not signal when no late run process remains', async () => {
    // Given
    const signals: number[] = []
    const dependencies = {
      enumerateProcesses: () => [],
      enumerateRunProcesses: () => ({ processes: [], runProcesses: [] }),
      killPid: pid => { signals.push(pid) },
      waitForProcessExit: async () => undefined,
    } satisfies CommunityPolicyProcessCleanupDependencies

    // When
    const failures = await cleanupOwnedProcesses(REQUEST, dependencies)

    // Then
    expect(signals).toEqual([])
    expect(failures).toEqual([])
  })
})
