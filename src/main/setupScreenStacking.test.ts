import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const setupScreenSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SetupScreen.tsx'),
  'utf8',
)
const passwordStepSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SetupPasswordStep.tsx'),
  'utf8',
)
const onboardingFoundationSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/ui2026/onboarding-foundation.css'),
  'utf8',
)
const securityModelSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SetupSecurityModel.tsx'),
  'utf8',
)

describe('SetupScreen foreground stacking', () => {
  it('keeps both setup steps above the absolute authentication backdrop', () => {
    expect(setupScreenSource).toContain('ui26-onboarding-frame ui26-onboarding-frame--welcome')
    expect(passwordStepSource).toContain('ui26-onboarding-frame ui26-onboarding-frame--password')

    const frameRule = onboardingFoundationSource.match(/\.ui26-onboarding-frame\s*\{([^}]*)\}/u)?.[1] ?? ''
    expect(frameRule).toMatch(/position:\s*relative;/u)
    expect(frameRule).toMatch(/z-index:\s*1;/u)
  })

  it('keeps vault creation disabled until a non-empty password is valid and confirmed', () => {
    expect(passwordStepSource).toMatch(
      /const ready\s*=\s*pw\.length > 0 && !policyError && pw === confirm && !loading/u,
    )
  })

  it('keeps each setup component within the workspace pairing limit', () => {
    expect(countPureLoc(setupScreenSource)).toBeLessThanOrEqual(250)
    expect(countPureLoc(passwordStepSource)).toBeLessThanOrEqual(250)
    expect(countPureLoc(securityModelSource)).toBeLessThanOrEqual(250)
  })

  it('keeps the security explanation within implemented trust and design boundaries', () => {
    expect(securityModelSource).not.toMatch(/#[0-9A-Fa-f]{3,8}|rgba?\(|style=|backdropFilter|boxShadow/)
    expect(securityModelSource).not.toMatch(/secret key|recovery code|mfa|multi-factor|cloud|secure enclave|sync|server/i)
  })
})

function countPureLoc(source: string): number {
  return source.split(/\r?\n/u).filter(line => {
    const trimmed = line.trim()
    return trimmed !== '' && !/^(?:\/\/|#|--)/u.test(trimmed)
  }).length
}
