import { contract, validateNoPayload, type BaseIpcResult, type NoPayload } from './ipcContracts'

export type AuditVerification =
  | { ok: true }
  | { ok: false; index: number; reason: string }

export interface AuditEvent {
  id: string
  timestamp: string
  type: string
  details: Record<string, unknown>
  previousHash: string | null
  hashScheme?: 'sha256' | 'hmac-sha256'
  hash: string
}

export type AuditReadResult = BaseIpcResult & {
  events?: AuditEvent[]
  verification?: AuditVerification
}
export type AuditExportJsonResult = BaseIpcResult & {
  cancelled?: boolean
  path?: string
}

export interface AuditIpcApi {
  auditRead(): Promise<AuditReadResult>
  auditExportJson(): Promise<AuditExportJsonResult>
}

export const auditIpcContracts = {
  read: contract<NoPayload, AuditReadResult>('audit:read', validateNoPayload),
  exportJson: contract<NoPayload, AuditExportJsonResult>('audit:export-json', validateNoPayload),
} as const
