import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  cleanupCommunityPolicyResources,
  type CommunityPolicyCleanupDependencies,
  type CommunityPolicyCleanupSignal,
} from './communityPolicyE2EResources'
import type { CommunityUIE2EProcessRecord } from './communityUIE2EProcessOwnership'

const ROOT_START = 'Sat Jul 18 10:00:00 2026'
const CHILD_START = 'Sat Jul 18 10:00:01 2026'
const OWNED_PARENT = '/tmp/vaultage-community-policy-late-child'
const RUN_TOKEN = 'vaultage-policy-fixture'
const OWNED_ROOT = join(OWNED_PARENT, RUN_TOKEN)

describe('Community policy late-child cleanup', () => {
  it('signals an exact-run child spawned and reparented while the application closes', async () => {
    // Given
    const signals: Array<{ readonly pid: number; readonly signal: CommunityPolicyCleanupSignal }> = []
    let current: readonly CommunityUIE2EProcessRecord[] = [
      { parentPid: 1, pid: 101, startToken: ROOT_START },
    ]
    const dependencies = {
      closeApplication: async () => {
        current = [{ parentPid: 1, pid: 202, startToken: CHILD_START }]
      },
      enumerateProcesses: () => current,
      enumerateRunProcesses: runToken => ({
        processes: current,
        runProcesses: runToken === RUN_TOKEN
          ? current.filter(processRecord => processRecord.pid === 202)
          : [],
      }),
      killPid: (pid, signal) => {
        signals.push({ pid, signal })
        current = current.filter(processRecord => processRecord.pid !== pid)
      },
      waitForProcessExit: async () => undefined,
      removeRoot: () => undefined,
      rootExists: () => false,
    } satisfies CommunityPolicyCleanupDependencies

    // When
    await cleanupCommunityPolicyResources({
      application: { close: async () => undefined },
      processOwnership: {
        rootIdentities: [{ pid: 101, startToken: ROOT_START }],
        observedIdentities: [{ pid: 101, startToken: ROOT_START }],
      },
      run: {
        root: OWNED_ROOT,
        ownedParent: OWNED_PARENT,
        profileDir: join(OWNED_ROOT, 'profile'),
      },
      sentinels: [],
    }, dependencies)

    // Then
    expect(signals).toEqual([{ pid: 202, signal: 'SIGTERM' }])
  })
})
