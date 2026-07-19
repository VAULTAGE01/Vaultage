import { execFileSync } from 'node:child_process'

const PROCESS_LINE_PATTERN = /^\s*([0-9]+)\s+([0-9]+)\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([0-9]{1,2})\s+([0-9]{2}):([0-9]{2}):([0-9]{2})\s+([0-9]{4})\s*$/u
const PROCESS_START_PATTERN = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{1,2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/u

export type CommunityUIE2EProcessIdentity = {
  readonly pid: number
  readonly startToken: string
}

export type CommunityUIE2EProcessRecord = CommunityUIE2EProcessIdentity & {
  readonly parentPid: number
}

export type CommunityUIE2EProcessOwnership = {
  readonly observedIdentities: readonly CommunityUIE2EProcessIdentity[]
  readonly rootIdentities: readonly CommunityUIE2EProcessIdentity[]
}

export type CommunityUIE2EProcessTrackerDependencies = {
  readonly captureRoot: (rootPid: number) => CommunityUIE2EProcessIdentity
  readonly enumerateOwned: (
    roots: readonly CommunityUIE2EProcessIdentity[],
  ) => readonly CommunityUIE2EProcessIdentity[]
}

export class CommunityUIE2EProcessEnumerationError extends Error {
  readonly name = 'CommunityUIE2EProcessEnumerationError'

  constructor(cause?: unknown) {
    super('Community UI E2E process enumeration failed', { cause })
  }
}

export function currentCommunityUIE2EUserId(): number {
  if (typeof process.getuid !== 'function') throw new CommunityUIE2EProcessEnumerationError()
  const currentUserId = process.getuid()
  if (!Number.isSafeInteger(currentUserId) || currentUserId < 0) {
    throw new CommunityUIE2EProcessEnumerationError()
  }
  return currentUserId
}

function identityKey(identity: CommunityUIE2EProcessIdentity): string {
  return `${identity.pid}\u0000${identity.startToken}`
}

function sameIdentity(
  left: CommunityUIE2EProcessIdentity,
  right: CommunityUIE2EProcessIdentity,
): boolean {
  return left.pid === right.pid && left.startToken === right.startToken
}

function sortedIdentities(
  identities: Iterable<CommunityUIE2EProcessIdentity>,
): readonly CommunityUIE2EProcessIdentity[] {
  return [...identities].sort((left, right) => (
    left.pid - right.pid || left.startToken.localeCompare(right.startToken)
  ))
}

function assertIdentity(identity: CommunityUIE2EProcessIdentity): void {
  if (
    !Number.isSafeInteger(identity.pid)
    || identity.pid <= 1
    || !PROCESS_START_PATTERN.test(identity.startToken)
  ) {
    throw new CommunityUIE2EProcessEnumerationError()
  }
}

function readNumericField(value: string | undefined, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CommunityUIE2EProcessEnumerationError()
  }
  return parsed
}

export function parseProcessTable(output: string): readonly CommunityUIE2EProcessRecord[] {
  const trimmed = output.trim()
  if (trimmed.length === 0) throw new CommunityUIE2EProcessEnumerationError()
  const seen = new Set<number>()
  return trimmed.split('\n').map(line => {
    const match = PROCESS_LINE_PATTERN.exec(line)
    if (!match) throw new CommunityUIE2EProcessEnumerationError()
    const pid = readNumericField(match[1], 1, Number.MAX_SAFE_INTEGER)
    const parentPid = readNumericField(match[2], 0, Number.MAX_SAFE_INTEGER)
    const day = readNumericField(match[5], 1, 31)
    readNumericField(match[6], 0, 23)
    readNumericField(match[7], 0, 59)
    readNumericField(match[8], 0, 59)
    readNumericField(match[9], 1970, 9999)
    const weekday = match[3]
    const month = match[4]
    const hour = match[6]
    const minute = match[7]
    const second = match[8]
    const year = match[9]
    if (!weekday || !month || !hour || !minute || !second || !year || seen.has(pid)) {
      throw new CommunityUIE2EProcessEnumerationError()
    }
    seen.add(pid)
    return { parentPid, pid, startToken: `${weekday} ${month} ${day} ${hour}:${minute}:${second} ${year}` }
  })
}

export function matchingProcessIdentities(
  candidates: readonly CommunityUIE2EProcessIdentity[],
  processes: readonly CommunityUIE2EProcessRecord[],
): readonly CommunityUIE2EProcessIdentity[] {
  const currentByPid = new Map(processes.map(processRecord => [processRecord.pid, processRecord]))
  const matches = new Map<string, CommunityUIE2EProcessIdentity>()
  for (const candidate of candidates) {
    assertIdentity(candidate)
    const current = currentByPid.get(candidate.pid)
    if (current && sameIdentity(candidate, current)) matches.set(identityKey(candidate), candidate)
  }
  return sortedIdentities(matches.values())
}

export function ownedProcessIdentities(
  roots: readonly CommunityUIE2EProcessIdentity[],
  processes: readonly CommunityUIE2EProcessRecord[],
): readonly CommunityUIE2EProcessIdentity[] {
  if (roots.length === 0) throw new CommunityUIE2EProcessEnumerationError()
  const children = new Map<number, CommunityUIE2EProcessRecord[]>()
  const currentByPid = new Map<number, CommunityUIE2EProcessRecord>()
  for (const processRecord of processes) {
    currentByPid.set(processRecord.pid, processRecord)
    const siblings = children.get(processRecord.parentPid) ?? []
    siblings.push(processRecord)
    children.set(processRecord.parentPid, siblings)
  }
  const owned = new Map<string, CommunityUIE2EProcessIdentity>()
  const pending: CommunityUIE2EProcessRecord[] = []
  for (const root of roots) {
    assertIdentity(root)
    const current = currentByPid.get(root.pid)
    if (current && sameIdentity(root, current)) pending.push(current)
  }
  while (pending.length > 0) {
    const processRecord = pending.pop()
    if (!processRecord || owned.has(identityKey(processRecord))) continue
    owned.set(identityKey(processRecord), {
      pid: processRecord.pid,
      startToken: processRecord.startToken,
    })
    pending.push(...(children.get(processRecord.pid) ?? []))
  }
  return sortedIdentities(owned.values())
}

export function enumerateProcessTable(): readonly CommunityUIE2EProcessRecord[] {
  try {
    return parseProcessTable(execFileSync('/bin/ps', [
      '-U',
      String(currentCommunityUIE2EUserId()),
      '-o',
      'pid=,ppid=,lstart=',
    ], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    }))
  } catch (error) {
    if (error instanceof CommunityUIE2EProcessEnumerationError) throw error
    throw new CommunityUIE2EProcessEnumerationError(error)
  }
}

export function captureProcessIdentity(rootPid: number): CommunityUIE2EProcessIdentity {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1) {
    throw new CommunityUIE2EProcessEnumerationError()
  }
  const processRecord = enumerateProcessTable().find(current => current.pid === rootPid)
  if (!processRecord) throw new CommunityUIE2EProcessEnumerationError()
  return { pid: processRecord.pid, startToken: processRecord.startToken }
}

export function enumerateOwnedProcessIdentities(
  roots: readonly CommunityUIE2EProcessIdentity[],
): readonly CommunityUIE2EProcessIdentity[] {
  return ownedProcessIdentities(roots, enumerateProcessTable())
}

const DEFAULT_TRACKER_DEPENDENCIES = {
  captureRoot: captureProcessIdentity,
  enumerateOwned: enumerateOwnedProcessIdentities,
} satisfies CommunityUIE2EProcessTrackerDependencies

export class CommunityUIE2EProcessTracker {
  private readonly observed = new Map<string, CommunityUIE2EProcessIdentity>()
  private readonly roots = new Map<string, CommunityUIE2EProcessIdentity>()

  constructor(
    private readonly dependencies: CommunityUIE2EProcessTrackerDependencies = DEFAULT_TRACKER_DEPENDENCIES,
  ) {}

  recordRoot(rootPid: number): void {
    const root = this.dependencies.captureRoot(rootPid)
    assertIdentity(root)
    this.roots.set(identityKey(root), root)
    this.observed.set(identityKey(root), root)
    const owned = this.dependencies.enumerateOwned([root])
    if (!owned.some(identity => sameIdentity(identity, root))) {
      throw new CommunityUIE2EProcessEnumerationError()
    }
    for (const identity of owned) {
      assertIdentity(identity)
      this.observed.set(identityKey(identity), identity)
    }
  }

  snapshot(): CommunityUIE2EProcessOwnership {
    return {
      observedIdentities: sortedIdentities(this.observed.values()),
      rootIdentities: sortedIdentities(this.roots.values()),
    }
  }
}
