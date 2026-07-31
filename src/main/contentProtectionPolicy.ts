export type WindowContentProtectionPolicy = {
  readonly isPackaged: boolean
  readonly screenshotReviewBuild: boolean
  readonly allowDevelopmentScreenshots: boolean
  readonly enableContentProtectionInDevelopment: boolean
}

export function resolveScreenshotReviewBuild(options: Readonly<{
  requested: boolean
  productionReleaseBuild: boolean
}>): boolean {
  if (options.requested && options.productionReleaseBuild) {
    throw new Error('Screenshot review mode cannot be embedded in a production release')
  }
  return options.requested
}

export function shouldUseWindowContentProtection(
  policy: WindowContentProtectionPolicy,
): boolean {
  if (policy.screenshotReviewBuild) return false
  if (policy.isPackaged) return true
  if (policy.allowDevelopmentScreenshots) return false
  return policy.enableContentProtectionInDevelopment
}
