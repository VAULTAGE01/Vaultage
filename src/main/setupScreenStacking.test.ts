import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SetupScreen.tsx'),
  'utf8',
)

describe('SetupScreen foreground stacking', () => {
  it('keeps both setup steps above the absolute authentication backdrop', () => {
    expect(source).toContain("'no-drag w-[440px] animate-scale-in relative z-10'")
    expect(source).toContain("'no-drag w-[400px] animate-scale-in relative z-10'")
  })

  it('keeps vault creation disabled until a non-empty password is valid and confirmed', () => {
    expect(source).toContain(
      'const ready    = pw.length > 0 && !policyError && pw === confirm && !loading',
    )
  })
})
