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
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      '.vaultage-open-source/**',
    ],
  },
})
