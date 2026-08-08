import { describe, expect, it } from 'vitest'
import { normalizeKeychainPrompt } from './keychain'

describe('Keychain native prompt boundary', () => {
  it('removes control and bidirectional formatting characters from untrusted labels', () => {
    expect(normalizeKeychainPrompt('Approve\nCodex\u202E spoof\u2066 · code ABCD-1234')).toBe(
      'Approve Codex spoof · code ABCD-1234',
    )
  })

  it('uses a bounded non-empty fallback', () => {
    expect(normalizeKeychainPrompt('\n\t')).toBe('Unlock Vaultage')
    expect(normalizeKeychainPrompt('x'.repeat(600))).toHaveLength(512)
  })
})
