import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * These are the production provider catalog, discovery, setup, roadmap, and
 * detail surfaces. Tests, fixtures, internal scorecards, and operational
 * diagnostics intentionally stay outside this source contract.
 */
function customerProviderSurfacePaths(repositoryRoot) {
  const componentPaths = readdirSync(resolve(repositoryRoot, 'src/renderer/src/components'))
    .filter(name => name.endsWith('.tsx') && !name.includes('.test.')
      && /^(AddProviderModal|AwsProjectEnvironmentDetail|PaidBetaProvider|Provider|ProvidersModal|ServiceCatalog)/.test(name))
    .map(name => `src/renderer/src/components/${name}`)
  const serviceSurfacePaths = readdirSync(resolve(repositoryRoot, 'src/renderer/src/ui2026/surfaces'))
    .filter(name => (name.startsWith('Services') || name.startsWith('services'))
      && (name.endsWith('.tsx') || name.endsWith('.ts'))
      && !name.includes('.test.'))
    .map(name => `src/renderer/src/ui2026/surfaces/${name}`)

  return {
    shared: [
      ...componentPaths,
      'src/renderer/src/ui2026/primitives/cards.open.tsx',
    ].sort(),
    privateOnly: [
      'marketing-web/src/HeroMockup.tsx',
      'src/renderer/src/lib/serviceCategories.ts',
      'src/renderer/src/ui2026/primitives/cards.tsx',
      ...serviceSurfacePaths,
    ].sort(),
  }
}

const FORBIDDEN_CUSTOMER_LABELS = /\bAvailable\b|\bComing soon\b/g
const FORBIDDEN_INTERNAL_READINESS = /(?:['"`]\s*(?:researching|experimental|partial|certification pending|connector built|unsupported|beta[- ]ready|in review|source preview|source-implemented-unverified|guided\/manual|planned\/unsupported)\s*['"`]|>\s*(?:researching|experimental|partial|certification pending|connector built|unsupported|beta[- ]ready|in review|source preview)\s*<\/)/gi

describe('customer provider state source contract', () => {
  it('keeps provider readiness binary and sourced from the typed projection', async () => {
    const repositoryRoot = resolve(import.meta.dirname, '..')
    const customerStateModulePath = resolve(repositoryRoot, 'src/shared/providerCustomerState.ts')
    if (existsSync(customerStateModulePath)) {
      const { CUSTOMER_PROVIDER_STATE_LABELS } = await import('../src/shared/providerCustomerState')
      expect(CUSTOMER_PROVIDER_STATE_LABELS).toEqual({
        available: 'Available',
        comingSoon: 'Coming soon',
      })
    } else {
      // The typed projection is intentionally private; Community must prove
      // that the private Services surfaces and provider lifecycle module are
      // absent instead of importing a module that was not staged.
      expect(existsSync(resolve(repositoryRoot, 'marketing-web'))).toBe(false)
      expect(existsSync(resolve(repositoryRoot, 'src/renderer/src/lib/serviceCategories.ts'))).toBe(false)
    }

    const surfacePaths = customerProviderSurfacePaths(repositoryRoot)
    for (const relativePath of surfacePaths.shared) {
      expect(existsSync(resolve(repositoryRoot, relativePath)), relativePath).toBe(true)
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toMatch(FORBIDDEN_CUSTOMER_LABELS)
      expect(source, relativePath).not.toMatch(FORBIDDEN_INTERNAL_READINESS)
    }
    for (const relativePath of surfacePaths.privateOnly) {
      const path = resolve(repositoryRoot, relativePath)
      if (!existsSync(path)) continue
      const source = readFileSync(path, 'utf8')
      expect(source, relativePath).not.toMatch(FORBIDDEN_CUSTOMER_LABELS)
      expect(source, relativePath).not.toMatch(FORBIDDEN_INTERNAL_READINESS)
    }

    const servicesSurfaceDirectory = resolve(repositoryRoot, 'src/renderer/src/ui2026/surfaces')
    const stagedServicesSurfaceNames = existsSync(servicesSurfaceDirectory)
      ? readdirSync(servicesSurfaceDirectory).filter(name => name.startsWith('Services') || name.startsWith('services'))
      : []
    if (!existsSync(resolve(repositoryRoot, 'marketing-web'))) {
      expect(stagedServicesSurfaceNames).toEqual([])
      expect(existsSync(resolve(repositoryRoot, 'src/renderer/src/lib/serviceCategories.ts'))).toBe(false)
      expect(existsSync(resolve(repositoryRoot, 'src/renderer/src/ui2026/primitives/cards.tsx'))).toBe(false)
    }

    const capabilityCardPath = existsSync(resolve(repositoryRoot, 'src/renderer/src/ui2026/primitives/cards.tsx'))
      ? resolve(repositoryRoot, 'src/renderer/src/ui2026/primitives/cards.tsx')
      : resolve(repositoryRoot, 'src/renderer/src/ui2026/primitives/cards.open.tsx')
    const capabilityCardSource = readFileSync(capabilityCardPath, 'utf8')
    expect(capabilityCardSource).not.toMatch(/\b(?:Certified|Connected)\b/)

    const marketingAppPath = resolve(repositoryRoot, 'marketing-web/src/App.tsx')
    if (!existsSync(marketingAppPath)) {
      expect(existsSync(resolve(repositoryRoot, 'marketing-web'))).toBe(false)
      return
    }
    const marketingAppSource = readFileSync(marketingAppPath, 'utf8')
    const providerLifecycleRow = marketingAppSource.match(
      /feature:\s*['"]Provider token lifecycle['"][\s\S]*?(?=\n\s*\},\n\s*\{)/,
    )?.[0]
    expect(providerLifecycleRow).toBeDefined()
    expect(providerLifecycleRow).toContain("status: 'yes'")
    expect(providerLifecycleRow).toContain('CUSTOMER_PROVIDER_STATE_LABELS.available')
  })
})
