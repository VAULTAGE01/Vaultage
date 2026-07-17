import type { IpcMain } from 'electron'
import type { SafeStorageLike } from './commercialStateStore.disabled'

interface CommunityPolicy {
  edition: 'community'
  tier: 'community'
  capabilities: ReadonlySet<never>
  activeProjectLimit: null
  canReadVault: true
  canExportVault: true
  canReadProjects: true
  canExportProjects: true
}
type ProCapability = 'pro.agent' | 'pro.services' | 'pro.extension' | 'cloud.oauth' | 'cloud.sync' | 'cloud.audit' | 'cloud.spend'

export interface CommercialRuntimeAccess {
  policy(): Promise<CommunityPolicy>
  hasCapability(capability: ProCapability): Promise<boolean>
  requireCapability(capability: ProCapability): Promise<void>
  acquireCapabilityLease(capability: ProCapability): Promise<CommercialCapabilityLease>
  authorizeVaultMutation(currentVault: unknown, command: Record<string, unknown>): Promise<Record<string, unknown>>
  authorizeProjectScan(currentVault: unknown, path: string, projectId?: string, replaceProjectId?: string): Promise<void>
  acquireProjectExportLease(currentVault: unknown, projectId: string): Promise<CommercialProjectExportLease>
  resume(): Promise<void>
  suspend(reason?: string): void
  dispose(): void
}

export interface CommercialCapabilityLease {
  readonly capability: ProCapability
  assertCurrent(): void
}

export interface CommercialProjectExportLease {
  assertCurrent(): void
}

interface InstallCommercialRuntimeOptions {
  ipcMain: IpcMain
  userDataPath: string
  safeStorage: SafeStorageLike
  randomId: () => string
  fetch?: typeof fetch
  openExternal?: (url: string) => Promise<void>
  showSaveDialog?: () => Promise<{ canceled: boolean; filePath?: string }>
  sendToRenderer?: (channel: string, payload: unknown) => void
  appVersion?: string
  deviceDisplayName?: string
  onCapabilitiesLost?: (capabilities: readonly ProCapability[]) => Promise<void> | void
}

/** Community builds intentionally install no commercial IPC or runtime. */
export async function installCommercialRuntime(
  _options: InstallCommercialRuntimeOptions,
): Promise<CommercialRuntimeAccess> {
  let suspended = false
  let disposed = false
  let generation = 0
  const assertAvailable = (): void => {
    if (suspended || disposed) throw new Error('Project export authorization changed; try again')
  }
  const policy: CommunityPolicy = {
    edition: 'community',
    tier: 'community',
    capabilities: new Set(),
    activeProjectLimit: null,
    canReadVault: true,
    canExportVault: true,
    canReadProjects: true,
    canExportProjects: true,
  }
  return {
    policy: async () => policy,
    hasCapability: async () => true,
    requireCapability: async () => undefined,
    acquireCapabilityLease: async capability => Object.freeze({ capability, assertCurrent: () => undefined }),
    authorizeVaultMutation: async (_currentVault, command) => command,
    authorizeProjectScan: async () => undefined,
    acquireProjectExportLease: async () => {
      assertAvailable()
      const acquiredGeneration = generation
      return Object.freeze({
        assertCurrent: () => {
          assertAvailable()
          if (generation !== acquiredGeneration) {
            throw new Error('Project export authorization changed; try again')
          }
        },
      })
    },
    resume: async () => {
      if (disposed) throw new Error('Commercial runtime is disposed')
      suspended = false
      generation += 1
    },
    suspend: () => {
      suspended = true
      generation += 1
    },
    dispose: () => {
      disposed = true
      generation += 1
    },
  }
}
