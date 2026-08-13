import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const componentRoot = resolve(process.cwd(), 'src/renderer/src/components')
const onboardingSources = [
  'SetupScreen.tsx',
  'SetupPasswordStep.tsx',
  'SetupSecurityModel.tsx',
  'EmergencyBackupRestoreScreen.tsx',
]
const onboardingStyleSources = [
  'onboarding.css',
  'onboarding-foundation.css',
  'onboarding-welcome.css',
  'onboarding-form.css',
  'onboarding-restore.css',
  'onboarding-responsive.css',
]

function readComponent(fileName) {
  return readFileSync(resolve(componentRoot, fileName), 'utf8')
}

describe('onboarding design contract', () => {
  it('keeps visual values in the shared onboarding token layer', () => {
    const source = onboardingSources.map(readComponent).join('\n')
    const styles = onboardingStyleSources
      .map(fileName => readFileSync(resolve(process.cwd(), 'src/renderer/src/ui2026', fileName), 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/\bstyle=\{\{/)
    expect(source).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i)
    expect(source).not.toMatch(/\b(?:bg|border|h|leading|max-w|rounded|shadow|text|tracking|w)-\[[^\]]+\]/)
    expect(styles).toContain('var(--ui26-accent)')
    expect(styles).toContain('var(--ui26-focus)')
    expect(styles).toContain('var(--ui26-success)')
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i)
  })
})
