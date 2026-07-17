import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const openCoreBuild = process.env['VAULTAGE_OPEN_CORE'] === '1'
const disableReactRefresh = process.env['VAULTAGE_DISABLE_REACT_REFRESH'] === '1'
let productionReleaseBuild = false


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

export default defineConfig({
  main: {
    define: {
      __VAULTAGE_OPEN_CORE__: JSON.stringify(openCoreBuild),
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
      minify: 'esbuild',
      rollupOptions: {
        input: openCoreBuild
          ? { index: resolve('src/main/index.ts') }
          : {
              index: resolve('src/main/index.ts'),
              providerWorker: resolve('src/main/providerWorker.ts'),
            },
      },
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
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
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: {
      __VAULTAGE_OPEN_CORE__: JSON.stringify(openCoreBuild),
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
        '#main-layout': openCoreBuild
          ? resolve('src/renderer/src/components/MainLayout.open.tsx')
          : resolve('src/renderer/src/components/MainLayout.tsx'),
        '#mode-context': openCoreBuild
          ? resolve('src/renderer/src/modeContext.open.tsx')
          : resolve('src/renderer/src/modeContext.tsx'),
        '#mode-switcher': openCoreBuild
          ? resolve('src/renderer/src/components/ModeSwitcher.open.tsx')
          : resolve('src/renderer/src/components/ModeSwitcher.tsx'),
        '#projects-view': openCoreBuild
          ? resolve('src/renderer/src/components/ProjectsView.open.tsx')
          : resolve('src/renderer/src/components/AgentView.tsx'),
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
        '#sidebar': openCoreBuild
          ? resolve('src/renderer/src/components/Sidebar.open.tsx')
          : resolve('src/renderer/src/components/Sidebar.tsx'),
        '#commercial-readiness': openCoreBuild
          ? resolve('src/renderer/src/components/CommercialReadiness.disabled.tsx')
          : resolve('src/renderer/src/components/CommercialReadiness.tsx'),
        '#commercial-project-activation': openCoreBuild
          ? resolve('src/renderer/src/components/CommercialProjectActivation.disabled.tsx')
          : resolve('src/renderer/src/components/CommercialProjectActivation.tsx'),
        '#commercial-capabilities': openCoreBuild
          ? resolve('src/renderer/src/lib/CommercialFeatureCapabilities.disabled.ts')
          : resolve('src/renderer/src/lib/CommercialFeatureCapabilities.ts'),
        '#commercial-account': openCoreBuild
          ? resolve('src/renderer/src/commercialAccountContext.disabled.tsx')
          : resolve('src/renderer/src/commercialAccountContext.tsx'),
        '#commercial-account-settings': openCoreBuild
          ? resolve('src/renderer/src/components/CommercialAccountSettings.disabled.tsx')
          : resolve('src/renderer/src/components/CommercialAccountSettings.tsx'),
      }
    },
    plugins: disableReactRefresh ? [] : [react()]
  }
})
