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

export type AuthStatusResult = {
  needsSetup: boolean
  incomplete?: boolean
  error?: string
}
export type AuthUnlockResult = BaseIpcResult & {
  data?: unknown
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

export interface AuthIpcApi {
  status(): Promise<AuthStatusResult>
  setup(password: AuthPasswordPayload): Promise<AuthUnlockResult>
  touchID(): Promise<AuthUnlockResult>
  confirmTouchID(prompt?: string): Promise<AuthConfirmResult>
  password(password: AuthPasswordPayload): Promise<AuthUnlockResult>
  changePassword(payload: AuthChangePasswordPayload): Promise<AuthChangePasswordResult>
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
