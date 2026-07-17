import { describe, expect, it } from 'vitest'
import {
  CLOSED_AUTH_BACKDROP_CONTRACT,
  CLOSED_SHELL_BACKGROUND_CONTRACT,
  OPEN_AUTH_BACKDROP_CONTRACT,
  OPEN_SHELL_BACKGROUND_CONTRACT,
} from './editionTheme'

describe('edition theme contracts', () => {
  it('keeps the open/community auth backdrop neutral instead of brand-green', () => {
    expect(OPEN_AUTH_BACKDROP_CONTRACT.gradientPalette).toBe('darkGrey')
    expect(OPEN_AUTH_BACKDROP_CONTRACT.gradientSpeed).toBe(0.18)
    expect(OPEN_AUTH_BACKDROP_CONTRACT.gradientOpacity).toBe(0.74)
    expect(OPEN_AUTH_BACKDROP_CONTRACT.patternClassName).toContain('opacity-28')
    expect(OPEN_AUTH_BACKDROP_CONTRACT.patternClassName).toContain('mix-blend-screen')
    expect(OPEN_AUTH_BACKDROP_CONTRACT.patternImages).toContain(
      'radial-gradient(circle at 82% 12%, rgba(210,220,214,0.052), transparent 24%)',
    )
  })

  it('keeps the closed app on the branded green liquid treatment', () => {
    expect(CLOSED_AUTH_BACKDROP_CONTRACT.gradientPalette).toBe('green')
    expect(CLOSED_AUTH_BACKDROP_CONTRACT.gradientSpeed).toBe(
      OPEN_AUTH_BACKDROP_CONTRACT.gradientSpeed,
    )
    expect(CLOSED_AUTH_BACKDROP_CONTRACT.gradientOpacity).toBe(
      OPEN_AUTH_BACKDROP_CONTRACT.gradientOpacity,
    )
    expect(CLOSED_AUTH_BACKDROP_CONTRACT.noiseClassName).toContain('liquid-noise')
    expect(CLOSED_AUTH_BACKDROP_CONTRACT.noiseClassName).toContain('opacity-30')
  })

  it('keeps the open/community shell pattern neutral', () => {
    expect(OPEN_SHELL_BACKGROUND_CONTRACT.patternClassName).toContain('opacity-35')
    expect(OPEN_SHELL_BACKGROUND_CONTRACT.patternClassName).toContain('mix-blend-screen')
    expect(OPEN_SHELL_BACKGROUND_CONTRACT.patternImages).toContain(
      'radial-gradient(circle at 82% 12%, rgba(210,220,214,0.055), transparent 24%)',
    )
  })

  it('keeps the closed shell on the branded liquid-noise class', () => {
    expect(CLOSED_SHELL_BACKGROUND_CONTRACT.patternClassName).toContain('liquid-noise')
    expect(CLOSED_SHELL_BACKGROUND_CONTRACT.patternClassName).toContain('opacity-35')
  })
})
