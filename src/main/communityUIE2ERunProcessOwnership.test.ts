import { describe, expect, it } from 'vitest'
import {
  CommunityUIE2ERunProcessEnumerationError,
  parseCommunityUIE2ERunProcessTable,
} from './communityUIE2ERunProcessOwnership'

const START = 'Sat Jul 18 10:00:00 2026'
const RUN_TOKEN = 'vaultage-policy-abcdef'

function processLine(pid: number, command: string): string {
  return `${pid} 1 ${START} ${command}`
}

describe('Community UI E2E run process ownership', () => {
  it('retains only process identity for the exact run token', () => {
    // Given
    const output = [
      processLine(101, `/app VAULTAGE_E2E_RUN_ID=${RUN_TOKEN} E2E_API_KEY=synthetic-secret`),
      processLine(102, `/app VAULTAGE_E2E_RUN_ID=${RUN_TOKEN}-similar`),
      processLine(103, `/app OTHER_VAULTAGE_E2E_RUN_ID=${RUN_TOKEN}`),
      processLine(104, '/app CI=1'),
    ].join('\n')

    // When
    const snapshot = parseCommunityUIE2ERunProcessTable(output, RUN_TOKEN)

    // Then
    expect(snapshot.processes.map(processRecord => processRecord.pid)).toEqual([101, 102, 103, 104])
    expect(snapshot.runProcesses.map(processRecord => processRecord.pid)).toEqual([101])
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-secret')
  })

  it.each([
    '',
    processLine(101, 'VAULTAGE_E2E_RUN_ID'),
    processLine(101, 'VAULTAGE_E2E_RUN_ID='),
    processLine(101, `VAULTAGE_E2E_RUN_ID=${RUN_TOKEN} VAULTAGE_E2E_RUN_ID=${RUN_TOKEN}`),
    processLine(101, 'VAULTAGE_E2E_RUN_ID=malformed'),
    `${processLine(101, '/app')}\n${processLine(101, '/other')}`,
  ])('fails closed for missing or malformed token enumeration data', output => {
    // Given / When / Then
    expect(() => parseCommunityUIE2ERunProcessTable(output, RUN_TOKEN)).toThrow(
      CommunityUIE2ERunProcessEnumerationError,
    )
  })

  it('rejects an invalid expected run token before parsing process data', () => {
    // Given / When / Then
    expect(() => parseCommunityUIE2ERunProcessTable(processLine(101, '/app'), 'malformed')).toThrow(
      CommunityUIE2ERunProcessEnumerationError,
    )
  })
})
