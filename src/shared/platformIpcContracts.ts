import {
  contract,
  requireBoolean,
  requireRecord,
  requireString,
  validateNoPayload,
  type BaseIpcResult,
  type NoPayload,
} from './ipcContracts'

export type SecureInputResult = BaseIpcResult & { available: boolean }
export type ProviderVotePayload = {
  providerId: string
  providerName: string
  source: string
}

export interface PlatformIpcApi {
  openExternal(url: string): Promise<BaseIpcResult>
  submitProviderVote(payload: ProviderVotePayload): Promise<BaseIpcResult>
  copyImportTemplate(): Promise<BaseIpcResult>
  setSecureInputEnabled(enabled: boolean): Promise<SecureInputResult>
}

export const platformIpcContracts = {
  setSecureInputEnabled: contract<boolean, SecureInputResult>('security:set-secure-input', validateBooleanPayload),
  openExternal: contract<string, BaseIpcResult>('shell:openExternal', validateUrlPayload),
  providerVote: contract<ProviderVotePayload, BaseIpcResult>('feedback:provider-vote', validateProviderVotePayload),
  copyImportTemplate: contract<NoPayload, BaseIpcResult>('import:copy-template', validateNoPayload),
} as const

function validateBooleanPayload(payload: unknown): boolean {
  return requireBoolean(payload, 'secure input enabled')
}

function validateUrlPayload(payload: unknown): string {
  return requireString(payload, 'external URL')
}

function validateProviderVotePayload(payload: unknown): ProviderVotePayload {
  const record = requireRecord(payload, 'provider vote payload')
  return {
    providerId: requireString(record.providerId, 'provider id'),
    providerName: requireString(record.providerName, 'provider name'),
    source: requireString(record.source, 'provider vote source'),
  }
}
