import { describe, expect, it } from 'vitest'
import {
  resolveScreenshotReviewBuild,
  shouldUseWindowContentProtection,
} from './contentProtectionPolicy'

describe('window content protection policy', () => {
  it('embeds screenshot review mode only in non-production builds', () => {
    expect(resolveScreenshotReviewBuild({
      requested: true,
      productionReleaseBuild: false,
    })).toBe(true)
    expect(() => resolveScreenshotReviewBuild({
      requested: true,
      productionReleaseBuild: true,
    })).toThrow('Screenshot review mode cannot be embedded in a production release')
  })

  it('protects packaged production builds by default', () => {
    // Given
    const policy = {
      isPackaged: true,
      screenshotReviewBuild: false,
      allowDevelopmentScreenshots: false,
      enableContentProtectionInDevelopment: false,
    }

    // When
    const protectedContent = shouldUseWindowContentProtection(policy)

    // Then
    expect(protectedContent).toBe(true)
  })

  it('allows screenshots in an explicitly embedded non-production review build', () => {
    // Given
    const policy = {
      isPackaged: true,
      screenshotReviewBuild: true,
      allowDevelopmentScreenshots: false,
      enableContentProtectionInDevelopment: true,
    }

    // When
    const protectedContent = shouldUseWindowContentProtection(policy)

    // Then
    expect(protectedContent).toBe(false)
  })

  it('ignores the development screenshot override in packaged builds', () => {
    const protectedContent = shouldUseWindowContentProtection({
      isPackaged: true,
      screenshotReviewBuild: false,
      allowDevelopmentScreenshots: true,
      enableContentProtectionInDevelopment: false,
    })

    expect(protectedContent).toBe(true)
  })

  it('keeps unpackaged development captureable unless protection is requested', () => {
    // Given
    const defaultPolicy = {
      isPackaged: false,
      screenshotReviewBuild: false,
      allowDevelopmentScreenshots: false,
      enableContentProtectionInDevelopment: false,
    }
    const protectedPolicy = {
      ...defaultPolicy,
      enableContentProtectionInDevelopment: true,
    }

    // When
    const defaultProtection = shouldUseWindowContentProtection(defaultPolicy)
    const requestedProtection = shouldUseWindowContentProtection(protectedPolicy)

    // Then
    expect(defaultProtection).toBe(false)
    expect(requestedProtection).toBe(true)
  })
})
