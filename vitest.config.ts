import { configDefaults, defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const fullAddSecretModal = new URL(
  './src/renderer/src/components/AddSecretModal.tsx',
  import.meta.url,
)
const openCoreBuild = process.env['VAULTAGE_OPEN_CORE'] === '1'
  || !existsSync(fileURLToPath(fullAddSecretModal))

export default defineConfig({
  define: {
    __VAULTAGE_OPEN_CORE__: JSON.stringify(openCoreBuild),
  },
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '#add-secret-modal': fileURLToPath(new URL(
        openCoreBuild
          ? './src/renderer/src/components/AddSecretModal.open.tsx'
          : fullAddSecretModal,
        import.meta.url,
      )),
      '#add-provider-modal': fileURLToPath(new URL(
        openCoreBuild
          ? './src/renderer/src/components/AddProviderModal.disabled.tsx'
          : './src/renderer/src/components/AddProviderModal.tsx',
        import.meta.url,
      )),
      '#commercial-readiness': fileURLToPath(new URL(
        openCoreBuild
          ? './src/renderer/src/components/CommercialReadiness.disabled.tsx'
          : './src/renderer/src/components/CommercialReadiness.tsx',
        import.meta.url,
      )),
      '#commercial-capabilities': fileURLToPath(new URL(
        openCoreBuild
          ? './src/renderer/src/lib/CommercialFeatureCapabilities.disabled.ts'
          : './src/renderer/src/lib/CommercialFeatureCapabilities.ts',
        import.meta.url,
      )),
      '#commercial-account': fileURLToPath(new URL(
        openCoreBuild
          ? './src/renderer/src/commercialAccountContext.disabled.tsx'
          : './src/renderer/src/commercialAccountContext.tsx',
        import.meta.url,
      )),
      '#commercial-account-settings': fileURLToPath(new URL(
        openCoreBuild
          ? './src/renderer/src/components/CommercialAccountSettings.disabled.tsx'
          : './src/renderer/src/components/CommercialAccountSettings.tsx',
        import.meta.url,
      )),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      '.vaultage-open-source/**',
      '.vaultage-open-source-test-*/**',
      'scripts/pages-production-release-operator.test.mjs',
    ],
  },
})
