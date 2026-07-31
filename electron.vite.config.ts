import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolveScreenshotReviewBuild } from './src/main/contentProtectionPolicy'
import { resolveUi2026BuildFlagsForEdition } from './src/main/ui2026BuildFlags'

// electron-vite 5's isolated-entry reporter assumes a TTY even in CI. Keep its
// sandbox-safe preload bundling usable when stdout is a pipe.
if (typeof process.stdout.clearLine !== 'function') process.stdout.clearLine = () => true
if (typeof process.stdout.cursorTo !== 'function') process.stdout.cursorTo = () => true
if (typeof process.stdout.moveCursor !== 'function') process.stdout.moveCursor = () => true

const openCoreBuild = process.env['VAULTAGE_OPEN_CORE'] === '1'
const disableReactRefresh = process.env['VAULTAGE_DISABLE_REACT_REFRESH'] === '1'
const ui2026Flags = resolveUi2026BuildFlagsForEdition(process.env, openCoreBuild)
const ui2026Showcase = !openCoreBuild
  && process.env['VAULTAGE_UI2026_SHOWCASE'] === '1'
  && process.env['NODE_ENV'] !== 'production'
let productionReleaseBuild = false
let buildOutputRoot = 'out'
let mainBuildInput: Record<string, string> = { index: resolve('src/main/index.ts') }


const screenshotReviewBuild = resolveScreenshotReviewBuild({
  requested: process.env['VAULTAGE_SCREENSHOT_REVIEW_BUILD'] === '1',
  productionReleaseBuild,
})

function rendererChunk(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined
  if (id.includes('/react@') || id.includes('/react-dom@') || id.includes('/scheduler@')) {
    return 'vendor-react'
  }
  if (id.includes('/lucide-react@') || id.includes('/simple-icons@')) {
    return 'vendor-icons'
  }
  return 'vendor-ui'
}

export function resolveRendererCompositionAliases(openCore: boolean): Record<string, string> {
  return {
    '#main-layout': openCore
      ? resolve('src/renderer/src/components/MainLayout.open.tsx')
      : resolve('src/renderer/src/components/MainLayout.tsx'),
    '#mode-context': openCore
      ? resolve('src/renderer/src/modeContext.open.tsx')
      : resolve('src/renderer/src/modeContext.tsx'),
    '#sidebar': openCore
      ? resolve('src/renderer/src/components/Sidebar.open.tsx')
      : resolve('src/renderer/src/components/Sidebar.tsx'),
  }
}

export function resolveRendererDestinationAliases(openCore: boolean): Record<string, string> {
  return {
    '#projects-view': openCore
      ? resolve('src/renderer/src/components/ProjectsView.open.tsx')
      : resolve('src/renderer/src/components/AgentView.tsx'),
    '#commercial-account-settings': openCore
      ? resolve('src/renderer/src/components/CommercialAccountSettings.disabled.tsx')
      : resolve('src/renderer/src/components/CommercialAccountSettings.tsx'),
  }
}

export default defineConfig({
  main: {
    define: {
      __VAULTAGE_OPEN_CORE__: JSON.stringify(openCoreBuild),
      __VAULTAGE_SCREENSHOT_REVIEW_BUILD__: JSON.stringify(screenshotReviewBuild),
    },
    resolve: {
      alias: {
        '#agent-composition': openCoreBuild
          ? resolve('src/main/agentComposition.disabled.ts')
          : resolve('src/main/agentComposition.ts'),
        '#extension-handoff': openCoreBuild
          ? resolve('src/main/extensionHandoff.disabled.ts')
          : resolve('src/main/extensionHandoff.ts'),
        '#extension-candidate-vault': openCoreBuild
          ? resolve('src/main/extensionCandidateVault.disabled.ts')
          : resolve('src/main/extensionCandidateVault.ts'),
        '#extension-native-host-composition': openCoreBuild
          ? resolve('src/main/extensionNativeHostComposition.disabled.ts')
          : productionReleaseBuild
            ? resolve('src/main/extensionNativeHostComposition.production.ts')
            : resolve('src/main/extensionNativeHostComposition.ts'),
        '#extension-native-host-ipc': openCoreBuild
          ? resolve('src/main/extensionNativeHostIpc.disabled.ts')
          : resolve('src/main/extensionNativeHostIpc.ts'),
        '#provider-ipc': openCoreBuild
          ? resolve('src/main/providerIpc.disabled.ts')
          : resolve('src/main/providerIpc.ts'),
        '#provider-recovery': openCoreBuild
          ? resolve('src/main/providerRecovery.disabled.ts')
          : resolve('src/main/providerRecovery.ts'),
        '#provider-vote': openCoreBuild
          ? resolve('src/main/providerVote.disabled.ts')
          : resolve('src/main/providerVote.ts'),
        '#provider-worker-client': openCoreBuild
          ? resolve('src/main/providerWorkerClient.disabled.ts')
          : resolve('src/main/providerWorkerClient.ts'),
        '#provider-basic-ops': openCoreBuild
          ? resolve('src/main/providerBasicOps.disabled.ts')
          : resolve('src/main/providerBasicOps.ts'),
        '#provider-lifecycle-ops': openCoreBuild
          ? resolve('src/main/providerLifecycleOps.disabled.ts')
          : resolve('src/main/providerLifecycleOps.ts'),
        '#commercial-runtime': openCoreBuild
          ? resolve('src/main/commercialRuntime.disabled.ts')
          : resolve('src/main/commercialRuntime.ts'),
      },
    },
    build: {
      outDir: resolve(buildOutputRoot, 'main'),
      minify: 'esbuild',
      rollupOptions: {
        input: mainBuildInput,
      },
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      outDir: resolve(buildOutputRoot, 'preload'),
      // Sandboxed preloads cannot require local shared chunks. Build each
      // bridge as a self-contained file so multiple preload entries remain
      // compatible with Electron's restricted sandbox loader.
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: openCoreBuild
          ? {
              index: resolve('src/preload/index.open.ts'),
              menuPanel: resolve('src/preload/menuPanel.ts'),
            }
          : {
              index: resolve('src/preload/index.ts'),
              menuPanel: resolve('src/preload/menuPanel.ts'),
            },
      },
    },
  },
  renderer: {
    define: {
      __VAULTAGE_OPEN_CORE__: JSON.stringify(openCoreBuild),
      __VAULTAGE_UI2026_FLAGS__: JSON.stringify(ui2026Flags),
      __VAULTAGE_UI2026_SHOWCASE__: JSON.stringify(ui2026Showcase),
    },
    esbuild: {
      jsx: 'automatic',
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
        supported: {
          destructuring: true,
        },
      },
    },
    build: {
      outDir: resolve(buildOutputRoot, 'renderer'),
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: rendererChunk,
        },
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@':         resolve('src/renderer/src'),
        ...resolveRendererCompositionAliases(openCoreBuild),
        ...resolveRendererDestinationAliases(openCoreBuild),
        '#add-secret-modal': openCoreBuild
          ? resolve('src/renderer/src/components/AddSecretModal.open.tsx')
          : resolve('src/renderer/src/components/AddSecretModal.tsx'),
        '#add-provider-modal': openCoreBuild
          ? resolve('src/renderer/src/components/AddProviderModal.disabled.tsx')
          : resolve('src/renderer/src/components/AddProviderModal.tsx'),
        '#create-cloudflare-token-modal': openCoreBuild
          ? resolve('src/renderer/src/components/CreateCloudflareTokenModal.disabled.tsx')
          : resolve('src/renderer/src/components/CreateCloudflareTokenModal.tsx'),
        '#integrations-view': openCoreBuild
          ? resolve('src/renderer/src/components/IntegrationsView.disabled.tsx')
          : resolve('src/renderer/src/components/IntegrationsView.tsx'),
        '#provider-icons': openCoreBuild
          ? resolve('src/renderer/src/components/ProviderIcons.disabled.tsx')
          : resolve('src/renderer/src/components/ProviderIcons.tsx'),
        '#secret-detail': openCoreBuild
          ? resolve('src/renderer/src/components/SecretDetail.open.tsx')
          : resolve('src/renderer/src/components/SecretDetail.tsx'),
        '#secret-request-panel': openCoreBuild
          ? resolve('src/renderer/src/components/SecretRequestPanel.disabled.tsx')
          : resolve('src/renderer/src/components/SecretRequestPanel.tsx'),
        '#service-categories': openCoreBuild
          ? resolve('src/renderer/src/lib/serviceCategories.disabled.ts')
          : resolve('src/renderer/src/lib/serviceCategories.ts'),
        '#service-category-icons': openCoreBuild
          ? resolve('src/renderer/src/components/serviceCategoryIcons.disabled.tsx')
          : resolve('src/renderer/src/components/serviceCategoryIcons.tsx'),
        '#commercial-readiness': openCoreBuild
          ? resolve('src/renderer/src/components/CommercialReadiness.disabled.tsx')
          : resolve('src/renderer/src/components/CommercialReadiness.tsx'),
        '#commercial-capabilities': openCoreBuild
          ? resolve('src/renderer/src/lib/CommercialFeatureCapabilities.disabled.ts')
          : resolve('src/renderer/src/lib/CommercialFeatureCapabilities.ts'),
        '#commercial-account': openCoreBuild
          ? resolve('src/renderer/src/commercialAccountContext.disabled.tsx')
          : resolve('src/renderer/src/commercialAccountContext.tsx'),
      }
    },
    plugins: disableReactRefresh ? [] : [react()]
  }
})
