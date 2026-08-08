import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SetupSecurityModel } from './SetupSecurityModel'

describe('SetupSecurityModel', () => {
  it('explains local custody and recovery boundaries before vault creation', () => {
    const markup = renderToStaticMarkup(<SetupSecurityModel />)

    expect(markup).toContain('aria-labelledby="setup-security-model-title"')
    expect(markup).toContain('<ul')
    expect(markup).toContain('Local encryption')
    expect(markup).toContain('A random vault key encrypts your vault on this Mac.')
    expect(markup).toContain('Password protection')
    expect(markup).toContain('Your master password derives a separate key that unlocks the vault key.')
    expect(markup).toContain('No password reset')
    expect(markup).toContain('Vaultage cannot recover or reset your master password.')
    expect(markup).not.toMatch(/<(?:button|input|a)\b/)
  })

})
