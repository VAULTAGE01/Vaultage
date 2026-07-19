import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  CommunityPolicyCleanupError,
  CommunityPolicyCloseTimeoutError,
  cleanupCommunityPolicyResources,
  type CommunityPolicyCleanupDependencies,
  type CommunityPolicyCleanupRequest,
  type CommunityPolicyCleanupSignal,
} from './communityPolicyE2EResources'
import type { CommunityUIE2EProcessRecord } from './communityUIE2EProcessOwnership'

const PROCESS_START = 'Sat Jul 18 10:00:00 2026'

function processRecord(pid: number, parentPid: number): CommunityUIE2EProcessRecord {
  return { parentPid, pid, startToken: PROCESS_START }
}

type CleanupCalls = {
  applicationCloses: number
  deletions: number
  enumerations: number
  existenceChecks: number
  kills: Array<{ readonly pid: number; readonly signal: CommunityPolicyCleanupSignal }>
  sentinelCloses: number
  waits: number
}

type CleanupFixture = {
  readonly calls: CleanupCalls
  readonly dependencies: CommunityPolicyCleanupDependencies
  readonly request: CommunityPolicyCleanupRequest
  readonly rootPresent: () => boolean
  readonly setRootPresent: (present: boolean) => void
}

const OWNED_PARENT = '/tmp/vaultage-community-policy-tests'
const OWNED_ROOT = join(OWNED_PARENT, 'vaultage-policy-fixture')

function createCleanupFixture(): CleanupFixture {
  const calls: CleanupCalls = {
    applicationCloses: 0,
    deletions: 0,
    enumerations: 0,
    existenceChecks: 0,
    kills: [],
    sentinelCloses: 0,
    waits: 0,
  }
  let rootPresent = true
  const dependencies: CommunityPolicyCleanupDependencies = {
    closeApplication: async () => { calls.applicationCloses += 1 },
    enumerateProcesses: () => { calls.enumerations += 1; return [] },
    enumerateRunProcesses: () => ({ processes: [], runProcesses: [] }),
    killPid: (pid, signal) => { calls.kills.push({ pid, signal }) },
    waitForProcessExit: async () => { calls.waits += 1 },
    removeRoot: () => { calls.deletions += 1; rootPresent = false },
    rootExists: () => { calls.existenceChecks += 1; return rootPresent },
  }
  const sentinels = [0, 1].map(() => ({
    url: 'http://127.0.0.1:1/probe',
    accepted: () => 0,
    close: async () => { calls.sentinelCloses += 1 },
  }))
  return {
    calls,
    dependencies,
    request: {
      application: { close: async () => undefined },
      processOwnership: {
        rootIdentities: [{ pid: 101, startToken: PROCESS_START }],
        observedIdentities: [{ pid: 101, startToken: PROCESS_START }],
      },
      run: {
        root: OWNED_ROOT,
        ownedParent: OWNED_PARENT,
        profileDir: join(OWNED_ROOT, 'profile'),
      },
      sentinels,
    },
    rootPresent: () => rootPresent,
    setRootPresent: present => { rootPresent = present },
  }
}

async function captureCleanupError(
  request: CommunityPolicyCleanupRequest,
  dependencies: CommunityPolicyCleanupDependencies,
): Promise<CommunityPolicyCleanupError> {
  try {
    await cleanupCommunityPolicyResources(request, dependencies)
  } catch (error) {
    if (error instanceof CommunityPolicyCleanupError) return error
    throw error
  }
  throw new TypeError('Expected cleanup to fail')
}

describe('Community policy E2E resource cleanup', () => {
  it('removes every owned resource when all cleanup adapters succeed', async () => {
    // Given
    const fixture = createCleanupFixture()

    // When
    await cleanupCommunityPolicyResources(fixture.request, fixture.dependencies)

    // Then
    expect(fixture.calls).toEqual({
      applicationCloses: 1,
      deletions: 1,
      enumerations: 6,
      existenceChecks: 1,
      kills: [],
      sentinelCloses: 2,
      waits: 2,
    })
    expect(fixture.rootPresent()).toBe(false)
  })

  it('removes a pre-launch run without attempting process enumeration', async () => {
    // Given
    const fixture = createCleanupFixture()
    const request = {
      ...fixture.request,
      application: null,
      processOwnership: { rootIdentities: [], observedIdentities: [] },
    }

    // When
    await cleanupCommunityPolicyResources(request, fixture.dependencies)

    // Then
    expect(fixture.calls).toMatchObject({ deletions: 1, enumerations: 0, waits: 0 })
    expect(fixture.rootPresent()).toBe(false)
  })

  it('continues cleanup after an application close timeout', async () => {
    // Given
    const fixture = createCleanupFixture()
    const dependencies = {
      ...fixture.dependencies,
      closeApplication: async () => { fixture.calls.applicationCloses += 1; throw new CommunityPolicyCloseTimeoutError() },
    }

    // When
    const error = await captureCleanupError(fixture.request, dependencies)

    // Then
    expect(error.stages).toContain('application-close')
    expect(fixture.calls).toMatchObject({ deletions: 1, enumerations: 6, sentinelCloses: 2, waits: 2 })
    expect(fixture.rootPresent()).toBe(false)
  })

  it('attempts every later process and root step after enumeration fails', async () => {
    // Given
    const fixture = createCleanupFixture()
    const syntheticFailure = new Error('synthetic enumeration failure')
    const dependencies = {
      ...fixture.dependencies,
      enumerateProcesses: () => {
        fixture.calls.enumerations += 1
        if (fixture.calls.enumerations === 1) throw syntheticFailure
        return []
      },
    }

    // When
    const error = await captureCleanupError(fixture.request, dependencies)

    // Then
    expect(error.stages).toContain('process-enumeration-SIGTERM')
    expect(fixture.calls).toMatchObject({ deletions: 1, enumerations: 5, sentinelCloses: 2, waits: 2 })
  })

  it('attempts every PID and later signal after one kill fails', async () => {
    // Given
    const fixture = createCleanupFixture()
    let current: readonly CommunityUIE2EProcessRecord[] = [
      processRecord(41, 1),
      processRecord(42, 41),
    ]
    const dependencies = {
      ...fixture.dependencies,
      enumerateProcesses: () => { fixture.calls.enumerations += 1; return current },
      enumerateRunProcesses: () => ({ processes: current, runProcesses: current }),
      killPid: (pid: number, signal: CommunityPolicyCleanupSignal) => {
        fixture.calls.kills.push({ pid, signal })
        if (pid === 41 && signal === 'SIGTERM') throw new Error('synthetic kill failure')
        current = current.filter(process => process.pid !== pid)
      },
    }
    const request = {
      ...fixture.request,
      processOwnership: {
        rootIdentities: [{ pid: 41, startToken: PROCESS_START }],
        observedIdentities: [
          { pid: 41, startToken: PROCESS_START },
          { pid: 42, startToken: PROCESS_START },
        ],
      },
    }

    // When
    const error = await captureCleanupError(request, dependencies)

    // Then
    expect(error.stages).toContain('process-kill-SIGTERM')
    expect(fixture.calls.kills).toEqual([
      { pid: 41, signal: 'SIGTERM' },
      { pid: 42, signal: 'SIGTERM' },
      { pid: 41, signal: 'SIGKILL' },
    ])
    expect(fixture.calls).toMatchObject({ deletions: 1, sentinelCloses: 2, waits: 2 })
  })

  it('reports residual owned PIDs only after root and sentinel cleanup', async () => {
    // Given
    const fixture = createCleanupFixture()
    const dependencies = {
      ...fixture.dependencies,
      enumerateProcesses: () => { fixture.calls.enumerations += 1; return [processRecord(73, 1)] },
      enumerateRunProcesses: () => ({ processes: [processRecord(73, 1)], runProcesses: [processRecord(73, 1)] }),
    }
    const request = {
      ...fixture.request,
      processOwnership: {
        rootIdentities: [{ pid: 73, startToken: PROCESS_START }],
        observedIdentities: [{ pid: 73, startToken: PROCESS_START }],
      },
    }

    // When
    const error = await captureCleanupError(request, dependencies)

    // Then
    expect(error.stages).toContain('process-residue')
    expect(fixture.calls).toMatchObject({ deletions: 1, enumerations: 6, sentinelCloses: 2, waits: 2 })
  })

  it('closes every sentinel and removes the root after one sentinel close fails', async () => {
    // Given
    const fixture = createCleanupFixture()
    const sentinels = fixture.request.sentinels.map((sentinel, index) => ({
      ...sentinel,
      close: async () => {
        fixture.calls.sentinelCloses += 1
        if (index === 0) throw new Error('synthetic sentinel close failure')
      },
    }))

    // When
    const error = await captureCleanupError({ ...fixture.request, sentinels }, fixture.dependencies)

    // Then
    expect(error.stages).toContain('sentinel-close')
    expect(fixture.calls).toMatchObject({ deletions: 1, sentinelCloses: 2 })
  })

  it('retries root deletion after the first deletion error', async () => {
    // Given
    const fixture = createCleanupFixture()
    const dependencies = {
      ...fixture.dependencies,
      removeRoot: () => {
        fixture.calls.deletions += 1
        if (fixture.calls.deletions === 1) throw new Error('synthetic deletion failure')
        fixture.setRootPresent(false)
      },
    }

    // When
    const error = await captureCleanupError(fixture.request, dependencies)

    // Then
    expect(error.stages).toContain('run-root-delete')
    expect(fixture.calls.deletions).toBe(2)
    expect(fixture.calls.existenceChecks).toBeGreaterThanOrEqual(1)
  })

  it('rejects a non-owned root without enumerating, killing, or deleting', async () => {
    // Given
    const fixture = createCleanupFixture()
    const outsideRoot = '/tmp/not-owned/vaultage-policy-fixture'
    const request = {
      ...fixture.request,
      run: { ...fixture.request.run, root: outsideRoot, profileDir: join(outsideRoot, 'profile') },
    }

    // When
    const error = await captureCleanupError(request, fixture.dependencies)

    // Then
    expect(error.stages).toContain('owned-root-validation')
    expect(fixture.calls).toMatchObject({ applicationCloses: 1, deletions: 0, enumerations: 0, kills: [], sentinelCloses: 2, waits: 0 })
  })

  it('retries deletion and rejects cleanup when the exact run root still exists', async () => {
    // Given
    const fixture = createCleanupFixture()
    const dependencies = {
      ...fixture.dependencies,
      removeRoot: () => { fixture.calls.deletions += 1 },
    }

    // When
    const error = await captureCleanupError(fixture.request, dependencies)

    // Then
    expect(error.stages).toContain('run-root-absence')
    expect(fixture.calls.deletions).toBe(2)
    expect(fixture.calls.existenceChecks).toBe(2)
    expect(fixture.rootPresent()).toBe(true)
  })
})
