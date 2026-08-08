export const CERTIFICATE_FORMATS = ['PEM', 'DER', 'PKCS12'] as const

export type CertificateFormat = typeof CERTIFICATE_FORMATS[number]

/**
 * Value-free certificate identity and validity data. Certificate and private
 * key bytes remain ordinary sensitive VaultSecret fields encrypted by the
 * existing vault storage boundary.
 */
export interface CertificateMetadata {
  readonly format: CertificateFormat
  readonly subject?: string
  readonly issuer?: string
  readonly serialNumber?: string
  readonly notBefore?: string
  readonly notAfter?: string
  readonly algorithm?: string
  readonly sha256Fingerprint?: string
}

export type CertificateMetadataValidationCode =
  | 'type'
  | 'unsupported_property'
  | 'required'
  | 'enum'
  | 'limit'
  | 'format'
  | 'range'

export class CertificateMetadataValidationError extends Error {
  readonly name = 'CertificateMetadataValidationError'

  constructor(
    readonly field: string,
    readonly code: CertificateMetadataValidationCode,
    readonly requirement: string,
  ) {
    super('Invalid certificate metadata')
  }
}

const CERTIFICATE_METADATA_KEYS = [
  'format',
  'subject',
  'issuer',
  'serialNumber',
  'notBefore',
  'notAfter',
  'algorithm',
  'sha256Fingerprint',
] as const
const CERTIFICATE_METADATA_KEY_SET = new Set<string>(CERTIFICATE_METADATA_KEYS)
const CERTIFICATE_FORMAT_SET = new Set<string>(CERTIFICATE_FORMATS)
const CERTIFICATE_SERIAL_RE = /^[0-9A-Fa-f]{1,128}$/
const SHA256_FINGERPRINT_RE = /^[0-9a-f]{64}$/
const ISO_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

/** Apply one exact, value-free metadata contract at every trusted boundary. */
export function assertCertificateMetadata(value: unknown): asserts value is CertificateMetadata {
  if (!isRecord(value)) certificateIssue('', 'type', 'must be an object')
  for (const key of Object.keys(value)) {
    if (!CERTIFICATE_METADATA_KEY_SET.has(key)) {
      certificateIssue(safeFieldName(key), 'unsupported_property', 'is an unsupported property')
    }
  }
  const format = requiredText(value.format, 'format', 16)
  if (!CERTIFICATE_FORMAT_SET.has(format)) certificateIssue('format', 'enum', 'uses an unsupported format')
  optionalText(value.subject, 'subject', 4_096)
  optionalText(value.issuer, 'issuer', 4_096)
  const serialNumber = optionalText(value.serialNumber, 'serialNumber', 128)
  if (serialNumber !== undefined && !CERTIFICATE_SERIAL_RE.test(serialNumber)) {
    certificateIssue('serialNumber', 'format', 'must be a hexadecimal certificate serial number')
  }
  if ((value.notBefore === undefined) !== (value.notAfter === undefined)) {
    certificateIssue(value.notBefore === undefined ? 'notBefore' : 'notAfter', 'required', 'is required with the validity window')
  }
  if (value.notBefore !== undefined && value.notAfter !== undefined) {
    const notBefore = requiredDateTime(value.notBefore, 'notBefore')
    const notAfter = requiredDateTime(value.notAfter, 'notAfter')
    if (Date.parse(notAfter) <= Date.parse(notBefore)) {
      certificateIssue('notAfter', 'range', 'must be later than the certificate start time')
    }
  }
  optionalText(value.algorithm, 'algorithm', 256)
  const fingerprint = optionalText(value.sha256Fingerprint, 'sha256Fingerprint', 64)
  if (fingerprint !== undefined && !SHA256_FINGERPRINT_RE.test(fingerprint)) {
    certificateIssue('sha256Fingerprint', 'format', 'must be a lowercase SHA-256 fingerprint')
  }
}

export const CERTIFICATE_EXPIRY_REMINDER_DAYS = 30

export type CertificateExpiryStatus = 'not-yet-valid' | 'valid' | 'expiring' | 'expired'

export interface CertificateExpiryProjection {
  readonly status: CertificateExpiryStatus
  readonly expiresAt: string
  readonly reminderAt: string
  readonly reminderDue: boolean
  readonly remainingDays: number
}

export class CertificateProjectionError extends Error {
  readonly name = 'CertificateProjectionError'
  readonly code = 'invalid-validity-window'

  constructor() {
    super('Certificate expiry projection requires a valid certificate window')
  }
}

const DAY_MS = 24 * 60 * 60 * 1_000

/** Project display/reminder state from already validated certificate metadata. */
export function projectCertificateExpiry(
  certificate: CertificateMetadata,
  nowMs: number,
): CertificateExpiryProjection {
  const notBeforeMs = typeof certificate.notBefore === 'string' ? Date.parse(certificate.notBefore) : Number.NaN
  const notAfterMs = typeof certificate.notAfter === 'string' ? Date.parse(certificate.notAfter) : Number.NaN
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(notBeforeMs)
    || !Number.isFinite(notAfterMs)
    || notAfterMs <= notBeforeMs
  ) {
    throw new CertificateProjectionError()
  }
  const reminderAtMs = notAfterMs - CERTIFICATE_EXPIRY_REMINDER_DAYS * DAY_MS
  const expired = nowMs >= notAfterMs
  const active = nowMs >= notBeforeMs && !expired
  const reminderDue = active && nowMs >= reminderAtMs
  const status: CertificateExpiryStatus = !active && !expired
    ? 'not-yet-valid'
    : expired
      ? 'expired'
      : reminderDue
        ? 'expiring'
        : 'valid'

  return {
    status,
    expiresAt: new Date(notAfterMs).toISOString(),
    reminderAt: new Date(reminderAtMs).toISOString(),
    reminderDue,
    remainingDays: expired ? 0 : Math.ceil((notAfterMs - nowMs) / DAY_MS),
  }
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') certificateIssue(field, 'type', 'must be a string')
  if (value.length === 0) certificateIssue(field, 'required', 'must not be empty')
  if (value.length > max) certificateIssue(field, 'limit', 'is too long')
  return value
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  return value === undefined ? undefined : requiredText(value, field, max)
}

function requiredDateTime(value: unknown, field: string): string {
  const dateTime = requiredText(value, field, 128)
  const match = ISO_DATE_TIME_RE.exec(dateTime)
  if (!match || !isIsoDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) {
    certificateIssue(field, 'format', 'must be an ISO 8601 date-time')
  }
  if (!Number.isFinite(Date.parse(dateTime))) certificateIssue(field, 'format', 'must be an ISO 8601 date-time')
  return dateTime
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function safeFieldName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : '[metadata-property]'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function certificateIssue(
  field: string,
  code: CertificateMetadataValidationCode,
  requirement: string,
): never {
  throw new CertificateMetadataValidationError(field, code, requirement)
}
