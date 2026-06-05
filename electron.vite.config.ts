import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const openCoreBuild = process.env['VAULTAGE_OPEN_CORE'] === '1'

export default defineConfig({
  main: {
    define: {
      __VAULTAGE_OPEN_CORE__: JSON.stringify(openCoreBuild),
    },
    resolve: {
      alias: {
        '#agent-auth-token': openCoreBuild
          ? resolve('src/main/agentAuthToken.disabled.ts')
          : resolve('src/main/agentAuthToken.ts'),
        '#agent-ipc': openCoreBuild
          ? resolve('src/main/agentIpc.disabled.ts')
          : resolve('src/main/agentIpc.ts'),
        '#agent-release': openCoreBuild
          ? resolve('src/main/agentRelease.disabled.ts')
          : resolve('src/main/agentRelease.ts'),
        '#agent-server': openCoreBuild
          ? resolve('src/main/agentServer.disabled.ts')
          : resolve('src/main/agentServer.ts'),
        '#provider-ipc': openCoreBuild
          ? resolve('src/main/providerIpc.disabled.ts')
          : resolve('src/main/providerIpc.ts'),
        '#provider-vote': openCoreBuild
          ? resolve('src/main/providerVote.disabled.ts')
          : resolve('src/main/providerVote.ts'),
        '#provider-worker-client': openCoreBuild
          ? resolve('src/main/providerWorkerClient.disabled.ts')
          : resolve('src/main/providerWorkerClient.ts'),
        '#provider-basic-ops': resolve('src/main/providerBasicOps.ts'),
        '#provider-lifecycle-ops': openCoreBuild
          ? resolve('src/main/providerLifecycleOps.disabled.ts')
          : resolve('src/main/providerLifecycleOps.ts'),
      },
    },
    build: {
      minify: openCoreBuild ? 'esbuild' : false,
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
          ? { index: resolve('src/preload/index.open.ts') }
          : { index: resolve('src/preload/index.ts') },
      },
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: {
      __VAULTAGE_OPEN_CORE__: JSON.stringify(openCoreBuild),
    },
    build: {
      minify: openCoreBuild ? 'esbuild' : false,
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
      }
    },
    plugins: [react()]
  }
})
