import { describe, expect, it } from 'vitest'
import {
  CommunityUIE2EProcessEnumerationError,
  CommunityUIE2EProcessTracker,
  matchingProcessIdentities,
  ownedProcessIdentities,
  parseProcessTable,
  type CommunityUIE2EProcessIdentity,
} from './communityUIE2EProcessOwnership'

const START_A = 'Sat Jul 18 10:00:00 2026'
const START_B = 'Sat Jul 18 10:00:01 2026'

function identity(pid: number, startToken = START_A): CommunityUIE2EProcessIdentity {
  return { pid, startToken }
}

function processLine(pid: number, parentPid: number, startToken = START_A): string {
  return `${pid} ${parentPid} ${startToken}`
}

describe('Community UI E2E process ownership', () => {
  it('records each launched root identity and its directly enumerated descendants', () => {
    // Given
    const tracker = new CommunityUIE2EProcessTracker({
      captureRoot: rootPid => identity(rootPid),
      enumerateOwned: roots => (
        roots[0]?.pid === 50
          ? [identity(50), identity(51)]
          : [identity(60), identity(61), identity(62)]
      ),
    })

    // When
    tracker.recordRoot(50)
    tracker.recordRoot(60)

    // Then
    expect(tracker.snapshot()).toEqual({
      rootIdentities: [identity(50), identity(60)],
      observedIdentities: [identity(50), identity(51), identity(60), identity(61), identity(62)],
    })
  })

  it('retains the captured root identity when later descendant traversal fails', () => {
    // Given
    const tracker = new CommunityUIE2EProcessTracker({
      captureRoot: rootPid => identity(rootPid),
      enumerateOwned: () => { throw new CommunityUIE2EProcessEnumerationError() },
    })

    // When / Then
    expect(() => tracker.recordRoot(70)).toThrow(CommunityUIE2EProcessEnumerationError)
    expect(tracker.snapshot()).toEqual({
      rootIdentities: [identity(70)],
      observedIdentities: [identity(70)],
    })
  })

  it('returns only an exact root identity and its transitive descendants', () => {
    // Given
    const processes = parseProcessTable([
      processLine(10, 1),
      processLine(11, 10),
      processLine(12, 11),
      processLine(20, 1),
      processLine(21, 20),
    ].join('\n'))

    // When
    const owned = ownedProcessIdentities([identity(10)], processes)

    // Then
    expect(owned).toEqual([identity(10), identity(11), identity(12)])
  })

  it('excludes a reused root PID and every unrelated identity', () => {
    // Given
    const processes = parseProcessTable([
      processLine(10, 1, START_B),
      processLine(11, 10, START_B),
      processLine(20, 1),
    ].join('\n'))

    // When
    const owned = ownedProcessIdentities([identity(10, START_A)], processes)

    // Then
    expect(owned).toEqual([])
  })

  it('matches a reparented descendant by PID and start token', () => {
    // Given
    const processes = parseProcessTable(processLine(12, 1))

    // When
    const current = matchingProcessIdentities([identity(12)], processes)

    // Then
    expect(current).toEqual([identity(12)])
  })

  it('rejects a reused PID with a different start token', () => {
    // Given
    const processes = parseProcessTable(processLine(12, 1, START_B))

    // When
    const current = matchingProcessIdentities([identity(12, START_A)], processes)

    // Then
    expect(current).toEqual([])
  })

  it.each([
    '',
    'not-a-pid 1 Sat Jul 18 10:00:00 2026\n',
    '10 1\n',
    '10 1 malformed-start-token\n',
    '10 1 Sat Jul 18 25:00:00 2026\n',
    '10 1 Sat Jul 18 10:00:00 2026 trailing\n',
    '10 1 Sat Jul 18 10:00:00 2026\n10 1 Sat Jul 18 10:00:00 2026\n',
  ])('rejects a malformed or missing process start token', output => {
    // Given / When / Then
    expect(() => parseProcessTable(output)).toThrow(CommunityUIE2EProcessEnumerationError)
  })

  it.each([0, 1, -3, Number.NaN])('rejects an unsafe Electron root PID', rootPid => {
    // Given
    const processes = parseProcessTable(processLine(10, 1))

    // When / Then
    expect(() => ownedProcessIdentities([identity(rootPid)], processes)).toThrow(
      CommunityUIE2EProcessEnumerationError,
    )
  })
})
