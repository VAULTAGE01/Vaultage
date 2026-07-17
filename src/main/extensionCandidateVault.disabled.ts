export interface ExtensionCandidateVaultInput {
  requestId: string
  name: string
  envKey: string
  value: string
  requestor: string
  provider?: string
  providerLabel?: string
  origin?: string
  host?: string
  path?: string
  title?: string
  receivedAt: string
}

export function addExtensionCandidateToVault(
  _vault: unknown,
  _candidate: Readonly<ExtensionCandidateVaultInput>,
  _options: { secretId: string; savedAt?: string },
): { vault: Record<string, unknown>; secretId: string } {
  throw new Error('Browser-extension candidate saves are unavailable in this build')
}
