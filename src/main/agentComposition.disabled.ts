/**
 * Community Agent seam. It intentionally exposes only the operational methods
 * shared main needs in order to stay fail closed. Credential authentication,
 * standing grants, mapping identities, policy inventory, and release contracts
 * do not exist in this edition.
 */
export function registerAgentComposition(_privateConfiguration: unknown) {
  let port = 43777
  const server = {
    pendingCount: () => 0,
    isApiEnabled: () => false,
    isExtensionEnabled: () => false,
    configuredPort: () => port,
    setApiEnabledState: (_enabled: boolean) => undefined,
    setExtensionEnabledState: (_enabled: boolean) => undefined,
    handleSetApiEnabled: (enabled: boolean) => enabled
      ? { success: false, error: 'Agent API is unavailable in this build' }
      : { success: true },
    handleSetExtensionEnabled: (enabled: boolean) => enabled
      ? { success: false, error: 'Browser extension bridge is unavailable in this build' }
      : { success: true },
    cancelPendingRequests: (_reason: string) => undefined,
    cancelPendingAgentRequests: (_reason: string) => undefined,
    syncListenerState: async () => undefined,
    handleCapabilitiesLost: async (_capabilities: readonly unknown[]) => undefined,
  }
  const configurePort = async (value: unknown) => {
    const candidate = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 1024 || candidate > 65535) {
      return { success: false, error: 'Agent API port must be an integer from 1024 to 65535' }
    }
    port = candidate
    return { success: true }
  }

  return Object.freeze({
    server,
    configurePort,
    rotateSession: () => undefined,
    clearStoredAccess: async () => undefined,
    initialize: async () => undefined,
    ensureReady: async () => undefined,
    isReady: () => false,
    parseHandoffUrl: (_rawUrl: string) => null,
    findHandoffArg: (_argv: readonly string[]) => null,
    instructionsSnippet: async () => '',
    clearCredentialDeposits: (_reason = 'vault_locked') => undefined,
    shutdown: () => undefined,
  })
}
