import { describe, expect, it } from 'vitest'
import {
  createDefaultSecretAccessPolicy,
  readSecretAccessPolicy,
  writeSecretAccessPolicy,
} from './secretAccessPolicy'

describe('secret access policy', () => {
  it('defaults every access surface on for a newly created secret', () => {
    expect(createDefaultSecretAccessPolicy()).toEqual({
      browserExtension: true,
      agent: true,
      revealCopy: true,
      cliExport: true,
    })
  })

  it.each([
    ['browserExtension', 'browserExtensionAllowed'],
    ['agent', 'agentAvailable'],
    ['revealCopy', 'revealAllowed'],
    ['cliExport', 'cliExportAllowed'],
  ] as const)('persists an explicit Off choice for %s', (policyKey, recordKey) => {
    const policy = createDefaultSecretAccessPolicy()
    policy[policyKey] = false

    const stored = writeSecretAccessPolicy({}, policy)

    expect(stored[recordKey]).toBe(false)
    expect(readSecretAccessPolicy(stored)[policyKey]).toBe(false)
  })

  it('preserves legacy behavior when the newer policy fields are absent', () => {
    expect(readSecretAccessPolicy({ agentAvailable: true })).toEqual({
      browserExtension: true,
      agent: true,
      revealCopy: true,
      cliExport: true,
    })
    expect(readSecretAccessPolicy({})).toEqual({
      browserExtension: false,
      agent: false,
      revealCopy: true,
      cliExport: true,
    })
  })
})
