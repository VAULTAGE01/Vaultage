import { execFileSync } from 'node:child_process'
import {
  CommunityUIE2EProcessEnumerationError,
  currentCommunityUIE2EUserId,
  parseProcessTable,
  type CommunityUIE2EProcessRecord,
} from './communityUIE2EProcessOwnership'

const PROCESS_WITH_COMMAND_PATTERN = /^\s*([0-9]+\s+[0-9]+\s+\S+\s+\S+\s+[0-9]+\s+[0-9]+:[0-9]+:[0-9]+\s+[0-9]+)\s+(.+)$/u
const RUN_TOKEN_PATTERN = /^vaultage-policy-[A-Za-z0-9_-]{6,128}$/u
const RUN_TOKEN_VARIABLE = 'VAULTAGE_E2E_RUN_ID'

export type CommunityUIE2ERunProcessSnapshot = {
  readonly processes: readonly CommunityUIE2EProcessRecord[]
  readonly runProcesses: readonly CommunityUIE2EProcessRecord[]
}

export class CommunityUIE2ERunProcessEnumerationError extends Error {
  readonly name = 'CommunityUIE2ERunProcessEnumerationError'

  constructor() {
    super('Community UI E2E run process enumeration failed')
  }
}

export function assertCommunityUIE2ERunToken(runToken: string): void {
  if (!RUN_TOKEN_PATTERN.test(runToken)) {
    throw new CommunityUIE2ERunProcessEnumerationError()
  }
}

function runTokenFromCommand(command: string): string | null {
  const assignments = command
    .trim()
    .split(/\s+/u)
    .filter(field => field === RUN_TOKEN_VARIABLE || field.startsWith(`${RUN_TOKEN_VARIABLE}=`))
  if (assignments.length === 0) return null
  if (assignments.length !== 1) throw new CommunityUIE2ERunProcessEnumerationError()
  const assignment = assignments[0]
  if (!assignment || assignment === RUN_TOKEN_VARIABLE) {
    throw new CommunityUIE2ERunProcessEnumerationError()
  }
  const runToken = assignment.slice(RUN_TOKEN_VARIABLE.length + 1)
  assertCommunityUIE2ERunToken(runToken)
  return runToken
}

export function parseCommunityUIE2ERunProcessTable(
  output: string,
  expectedRunToken: string,
): CommunityUIE2ERunProcessSnapshot {
  assertCommunityUIE2ERunToken(expectedRunToken)
  const trimmed = output.trim()
  if (trimmed.length === 0) throw new CommunityUIE2ERunProcessEnumerationError()
  const seen = new Set<number>()
  const processes: CommunityUIE2EProcessRecord[] = []
  const runProcesses: CommunityUIE2EProcessRecord[] = []
  for (const line of trimmed.split('\n')) {
    const match = PROCESS_WITH_COMMAND_PATTERN.exec(line)
    if (!match?.[1] || !match[2]) throw new CommunityUIE2ERunProcessEnumerationError()
    let processRecord: CommunityUIE2EProcessRecord
    try {
      const parsed = parseProcessTable(match[1])
      if (parsed.length !== 1 || !parsed[0]) throw new CommunityUIE2EProcessEnumerationError()
      processRecord = parsed[0]
    } catch {
      throw new CommunityUIE2ERunProcessEnumerationError()
    }
    if (seen.has(processRecord.pid)) throw new CommunityUIE2ERunProcessEnumerationError()
    seen.add(processRecord.pid)
    processes.push(processRecord)
    if (runTokenFromCommand(match[2]) === expectedRunToken) runProcesses.push(processRecord)
  }
  return { processes, runProcesses }
}

export function enumerateCommunityUIE2ERunProcesses(
  expectedRunToken: string,
): CommunityUIE2ERunProcessSnapshot {
  assertCommunityUIE2ERunToken(expectedRunToken)
  try {
    const currentUserId = currentCommunityUIE2EUserId()
    const output = execFileSync('/bin/ps', [
      '-Eww',
      '-U',
      String(currentUserId),
      '-o',
      'pid=,ppid=,lstart=,command=',
    ], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    return parseCommunityUIE2ERunProcessTable(output, expectedRunToken)
  } catch {
    // Raw process arguments and environment values must never escape this adapter.
    throw new CommunityUIE2ERunProcessEnumerationError()
  }
}
