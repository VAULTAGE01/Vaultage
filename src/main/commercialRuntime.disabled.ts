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
  acquireProjectScanLease(currentVault: unknown, path: string, projectId?: string): Promise<CommercialProjectScanLease>
  acquireProjectExportLease(currentVault: unknown, projectId: string): Promise<CommercialProjectExportLease>
  /** Community deliberately accepts no billing state; this keeps shared protocol routing inert. */
  observeHostedBillingReturn(input: {
    readonly kind: 'checkout'
    readonly outcome: 'returned' | 'cancelled'
    readonly returnToken: string
  }): Promise<void>
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

export interface CommercialProjectScanLease {
  assertCurrent(): Promise<void>
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
  const assertAvailable = (operation: 'scan' | 'export'): void => {
    if (suspended || disposed) throw new Error(`Project ${operation} authorization changed; try again`)
  }
  const acquireProjectScanLease = async (): Promise<CommercialProjectScanLease> => {
    assertAvailable('scan')
    const acquiredGeneration = generation
    return Object.freeze({
      assertCurrent: async () => {
        assertAvailable('scan')
        if (generation !== acquiredGeneration) {
          throw new Error('Project scan authorization changed; try again')
        }
      },
    })
  }
  const acquireProjectExportLease = async (): Promise<CommercialProjectExportLease> => {
    assertAvailable('export')
    const acquiredGeneration = generation
    return Object.freeze({
      assertCurrent: () => {
        assertAvailable('export')
        if (generation !== acquiredGeneration) {
          throw new Error('Project export authorization changed; try again')
        }
      },
    })
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
  const capabilityError = (capability: ProCapability): Error => new Error(
    `Commercial capability ${capability} is unavailable in Vaultage Community`,
  )
  return {
    policy: async () => policy,
    hasCapability: async () => false,
    requireCapability: async capability => { throw capabilityError(capability) },
    acquireCapabilityLease: async capability => { throw capabilityError(capability) },
    authorizeVaultMutation: async (_currentVault, command) => command,
    acquireProjectScanLease,
    acquireProjectExportLease,
    observeHostedBillingReturn: async _input => undefined,
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
