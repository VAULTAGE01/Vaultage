import {
  contract,
  optionalString,
  requireRecord,
  requireString,
  validateNoPayload,
  type BaseIpcResult,
  type NoPayload,
} from './ipcContracts'

export type AuthPasswordPayload = string
export type AuthConfirmPayload = { prompt?: string }
export type AuthChangePasswordPayload = { current: string; next: string }
export type AuthRecoveryPasswordPayload = { currentPassword: string }
export type AuthRecoveryCodePayload = { recoveryCode: string }
export type AuthRecoverWithKitPayload = { recoveryCode: string; newPassword: string }

export type AuthErrorCode = 'setup_interrupted' | 'recovery_pdf_save_failed'

export const AUTH_SETUP_INTERRUPTED_MESSAGE = 'Vaultage could not finish setup safely. Reopen Vaultage to check the local vault, then try again if setup is still required.'
export const AUTH_RECOVERY_PDF_SAVE_FAILED_MESSAGE = 'Vaultage could not save the Emergency Kit PDF. Choose another location and try again.'

export interface AuthRecoveryKitMetadata {
  format: 'vaultage.recovery-kit.v1'
  generation: string
  createdAt: string
  verifiedAt?: string
  vaultFingerprint: string
}

export interface AuthRecoveryKitMaterial extends AuthRecoveryKitMetadata {
  recoveryCode: string
}

export type AuthStatusResult = {
  needsSetup: boolean
  incomplete?: boolean
  error?: string
}
export type AuthUnlockResult = BaseIpcResult & {
  errorCode?: AuthErrorCode
  data?: unknown
  recoveryKit?: AuthRecoveryKitMaterial
  touchIdRestored?: boolean
  cancelled?: boolean
  notFound?: boolean
  authFailed?: boolean
  touchIdInvalid?: boolean
  wrongPassword?: boolean
  alreadySetup?: boolean
  incomplete?: boolean
  sessionChanged?: boolean
}
export type AuthConfirmResult = BaseIpcResult & {
  cancelled?: boolean
  notFound?: boolean
  authFailed?: boolean
}
export type AuthChangePasswordResult = BaseIpcResult & {
  wrongPassword?: boolean
  touchIdRestored?: boolean
}
export type AuthRecoveryStatusResult = BaseIpcResult & {
  data?: { configured: boolean; metadata?: AuthRecoveryKitMetadata }
}
export type AuthRecoveryActionResult = BaseIpcResult & {
  data?: AuthRecoveryKitMaterial | AuthRecoveryKitMetadata | unknown
  recoveryKit?: AuthRecoveryKitMaterial
  touchIdRestored?: boolean
  wrongPassword?: boolean
  wrongRecoveryCode?: boolean
  retryAfterMs?: number
  sessionChanged?: boolean
}
export type AuthRecoveryPdfResult = BaseIpcResult & {
  cancelled?: boolean
  errorCode?: AuthErrorCode
  path?: string
}

export interface AuthIpcApi {
  status(): Promise<AuthStatusResult>
  setup(password: AuthPasswordPayload): Promise<AuthUnlockResult>
  touchID(): Promise<AuthUnlockResult>
  confirmTouchID(prompt?: string): Promise<AuthConfirmResult>
  password(password: AuthPasswordPayload): Promise<AuthUnlockResult>
  changePassword(payload: AuthChangePasswordPayload): Promise<AuthChangePasswordResult>
  recoveryStatus(): Promise<AuthRecoveryStatusResult>
  createRecoveryKit(payload: AuthRecoveryPasswordPayload): Promise<AuthRecoveryActionResult>
  verifyRecoveryKit(payload: AuthRecoveryCodePayload): Promise<AuthRecoveryActionResult>
  saveRecoveryKitPdf(payload: AuthRecoveryCodePayload): Promise<AuthRecoveryPdfResult>
  revokeRecoveryKit(payload: AuthRecoveryPasswordPayload): Promise<AuthRecoveryActionResult>
  recoverWithKit(payload: AuthRecoverWithKitPayload): Promise<AuthRecoveryActionResult>
}

export const authIpcContracts = {
  status: contract<NoPayload, AuthStatusResult>('auth:status', validateNoPayload),
  setup: contract<AuthPasswordPayload, AuthUnlockResult>('auth:setup', validatePasswordPayload),
  touchID: contract<NoPayload, AuthUnlockResult>('auth:touchid', validateNoPayload),
  confirm: contract<AuthConfirmPayload, AuthConfirmResult>('auth:confirm', validateConfirmPayload),
  password: contract<AuthPasswordPayload, AuthUnlockResult>('auth:password', validatePasswordPayload),
  changePassword: contract<AuthChangePasswordPayload, AuthChangePasswordResult>(
    'auth:change-password',
    validateChangePasswordPayload,
  ),
  recoveryStatus: contract<NoPayload, AuthRecoveryStatusResult>(
    'auth:recovery-status',
    validateNoPayload,
  ),
  createRecoveryKit: contract<AuthRecoveryPasswordPayload, AuthRecoveryActionResult>(
    'auth:create-recovery-kit',
    validateRecoveryPasswordPayload,
  ),
  verifyRecoveryKit: contract<AuthRecoveryCodePayload, AuthRecoveryActionResult>(
    'auth:verify-recovery-kit',
    validateRecoveryCodePayload,
  ),
  saveRecoveryKitPdf: contract<AuthRecoveryCodePayload, AuthRecoveryPdfResult>(
    'auth:save-recovery-kit-pdf',
    validateRecoveryCodePayload,
  ),
  revokeRecoveryKit: contract<AuthRecoveryPasswordPayload, AuthRecoveryActionResult>(
    'auth:revoke-recovery-kit',
    validateRecoveryPasswordPayload,
  ),
  recoverWithKit: contract<AuthRecoverWithKitPayload, AuthRecoveryActionResult>(
    'auth:recover-with-kit',
    validateRecoverWithKitPayload,
  ),
} as const

function validatePasswordPayload(payload: unknown): AuthPasswordPayload {
  return requireString(payload, 'password')
}

function validateConfirmPayload(payload: unknown): AuthConfirmPayload {
  if (payload === undefined || payload === null) return {}
  const record = requireRecord(payload, 'auth confirmation payload')
  return { prompt: optionalString(record.prompt, 'prompt') }
}

function validateChangePasswordPayload(payload: unknown): AuthChangePasswordPayload {
  const record = requireRecord(payload, 'change password payload')
  return {
    current: requireString(record.current, 'current password'),
    next: requireString(record.next, 'new password'),
  }
}

function validateRecoveryPasswordPayload(payload: unknown): AuthRecoveryPasswordPayload {
  const record = requireRecord(payload, 'recovery password payload')
  return { currentPassword: requireString(record.currentPassword, 'current password') }
}

function validateRecoveryCodePayload(payload: unknown): AuthRecoveryCodePayload {
  const record = requireRecord(payload, 'recovery code payload')
  return { recoveryCode: requireString(record.recoveryCode, 'recovery code') }
}

function validateRecoverWithKitPayload(payload: unknown): AuthRecoverWithKitPayload {
  const record = requireRecord(payload, 'Emergency Kit recovery payload')
  return {
    recoveryCode: requireString(record.recoveryCode, 'recovery code'),
    newPassword: requireString(record.newPassword, 'new password'),
  }
}
