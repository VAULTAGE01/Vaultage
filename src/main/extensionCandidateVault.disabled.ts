export interface ExtensionCandidateVaultInput {
  readonly requestId: string
  readonly name: string
  readonly envKey?: string
  readonly value?: string
  readonly bundle?: {
    readonly kind: string
    readonly name: string
    readonly vaultType: string
    readonly fields: readonly {
      readonly id: string
      readonly role: string
      readonly label: string
      readonly value: string
      readonly envKey: string
      readonly sensitive: boolean
    }[]
  }
  readonly requestor: string
  readonly destinationFolderId: string
  readonly destination?: {
    readonly projectId: string
    readonly environmentId: string
  }
  readonly provider?: string
  readonly providerLabel?: string
  readonly origin?: string
  readonly host?: string
  readonly path?: string
  readonly title?: string
  readonly receivedAt: string
}

export interface ExtensionCandidateVaultOptions {
  readonly secretId: string
  readonly fieldIds: {
    readonly service: string
    readonly value: string
    readonly origin: string
  }
  readonly bundleFieldIds?: readonly string[]
  readonly savedAt?: string
}

export interface ExtensionCandidateTransactionOptions extends ExtensionCandidateVaultOptions {
  readonly fallbackRevision: number
}

export function prepareExtensionCandidateVaultUpdate(
  _snapshot: unknown,
  _candidate: Readonly<ExtensionCandidateVaultInput & { readonly expectedRevision: number }>,
  _options: ExtensionCandidateTransactionOptions,
): { readonly snapshot: Record<string, unknown>; readonly secretId: string; readonly revision: number } {
  throw new Error('Browser-extension candidate saves are unavailable in this build')
}

export function addExtensionCandidateToVault(
  _vault: unknown,
  _candidate: Readonly<ExtensionCandidateVaultInput>,
  _options: ExtensionCandidateVaultOptions,
): { readonly vault: Record<string, unknown>; readonly secretId: string } {
  throw new Error('Browser-extension candidate saves are unavailable in this build')
}
