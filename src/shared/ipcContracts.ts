export interface IpcContract<Request, Response> {
  readonly channel: string
  readonly validate: (payload: unknown) => Request
  readonly response?: Response
}

export type NoPayload = undefined
export type BaseIpcResult = { success: boolean; error?: string }

export function contract<Request, Response>(
  channel: string,
  validate: (payload: unknown) => Request,
): IpcContract<Request, Response> {
  return { channel, validate }
}

export function validateNoPayload(payload: unknown): undefined {
  if (payload !== undefined) throw new Error('Unexpected IPC payload')
  return undefined
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

export function requireNonEmptyString(value: unknown, label: string): string {
  const text = requireString(value, label).trim()
  if (!text || text.length > 512 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`Invalid ${label}`)
  }
  return text
}

export function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireString(value, label)
}

export function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireNonEmptyString(value, label)
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

export function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  return requireBoolean(value, label)
}

export function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number`)
  return value
}

export function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return requireNumber(value, label)
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map(item => requireString(item, label))
}

export function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  return requireStringArray(value, label)
}

export function requireStringRecord(value: unknown, label: string): Record<string, string> {
  const record = requireRecord(value, label)
  const out: Record<string, string> = {}
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== 'string') throw new Error(`${label}.${key} must be a string`)
    out[key] = entryValue
  }
  return out
}
