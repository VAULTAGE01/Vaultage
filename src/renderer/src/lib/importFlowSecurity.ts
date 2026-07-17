import { VAULT_VALIDATION_LIMITS } from '../../../shared/vaultValidation'
import type { VaultFolder, VaultRoot } from '../types'

/**
 * Import-specific selection cap. The vault can hold far more secrets, but a
 * single picker event must stay small enough to review and process safely.
 */
export const MAX_IMAGE_IMPORT_SELECTION_COUNT = 100
export const MAX_IMAGE_IMPORT_DECODED_BYTES = VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytes
export const MAX_IMAGE_IMPORT_AGGREGATE_DECODED_BYTES =
  VAULT_VALIDATION_LIMITS.maxEmbeddedImageBytesAggregate

export interface ImageImportCandidate {
  name: string
  size: number
  type: string
}

export type ImageImportSelectionResult<T extends ImageImportCandidate> =
  | {
      ok: true
      items: Array<{ file: T; dataUrl: string | null; error: unknown | null }>
      decodedBytes: number
    }
  | { ok: false; error: string }

/**
 * Bounds the complete selection before invoking FileReader. For a File read as
 * a data URL, File.size is the decoded base64 payload size, so this preflight
 * uses the same byte budget enforced by canonical vault validation.
 */
export async function readBoundedImageImportSelection<T extends ImageImportCandidate>(
  files: readonly T[],
  readDataUrl: (file: T) => Promise<string>,
): Promise<ImageImportSelectionResult<T>> {
  const validationError = validateImageImportSelection(files)
  if (validationError) return { ok: false, error: validationError }

  const items: Array<{ file: T; dataUrl: string | null; error: unknown | null }> = []
  for (const file of files) {
    try {
      items.push({ file, dataUrl: await readDataUrl(file), error: null })
    } catch (error) {
      items.push({ file, dataUrl: null, error })
    }
  }
  return {
    ok: true,
    items,
    decodedBytes: files.reduce((total, file) => total + file.size, 0),
  }
}

export function validateImageImportSelection(files: readonly ImageImportCandidate[]): string | null {
  if (files.length === 0) return 'Choose image files'
  if (files.length > MAX_IMAGE_IMPORT_SELECTION_COUNT) {
    return `Choose at most ${MAX_IMAGE_IMPORT_SELECTION_COUNT} images at a time`
  }

  let decodedBytes = 0
  for (const file of files) {
    if (!file.type.toLowerCase().startsWith('image/')) {
      return `${file.name || 'Selected file'} is not an image`
    }
    if (!Number.isSafeInteger(file.size) || file.size < 1) {
      return `${file.name || 'Selected image'} is empty or has an invalid size`
    }
    if (file.size > MAX_IMAGE_IMPORT_DECODED_BYTES) {
      return `${file.name || 'Selected image'} is larger than ${formatMiB(MAX_IMAGE_IMPORT_DECODED_BYTES)} MB`
    }
    decodedBytes += file.size
    if (decodedBytes > MAX_IMAGE_IMPORT_AGGREGATE_DECODED_BYTES) {
      return `Selected images exceed the ${formatMiB(MAX_IMAGE_IMPORT_AGGREGATE_DECODED_BYTES)} MB total limit`
    }
  }
  return null
}

export interface ImportParseAttempt {
  readonly id: number
  readonly fingerprint: string
  readonly input: string
}

/**
 * Makes async decrypt/parse results single-writer. IDs reject superseded work;
 * the fingerprint plus exact input comparison rejects results for edited data.
 */
export class ImportParseAttemptGate {
  private activeId = 0

  begin(input: string): ImportParseAttempt {
    const attempt = Object.freeze({
      id: ++this.activeId,
      fingerprint: fingerprintImportInput(input),
      input,
    })
    return attempt
  }

  invalidate(): void {
    this.activeId++
  }

  isCurrent(attempt: ImportParseAttempt, currentInput: string): boolean {
    return attempt.id === this.activeId &&
      attempt.input === currentInput &&
      attempt.fingerprint === fingerprintImportInput(currentInput)
  }
}

export type GuardedImportAttemptResult<T> =
  | { status: 'current'; value: T }
  | { status: 'error'; error: unknown }
  | { status: 'stale' }

export async function runGuardedImportAttempt<T>(
  gate: ImportParseAttemptGate,
  input: string,
  currentInput: () => string,
  operation: () => Promise<T>,
): Promise<GuardedImportAttemptResult<T>> {
  const attempt = gate.begin(input)
  try {
    const value = await operation()
    return gate.isCurrent(attempt, currentInput())
      ? { status: 'current', value }
      : { status: 'stale' }
  } catch (error) {
    return gate.isCurrent(attempt, currentInput())
      ? { status: 'error', error }
      : { status: 'stale' }
  }
}

export function isCurrentImportDestination(vault: VaultRoot | null, folderId: string | null): boolean {
  if (!vault || !folderId) return false
  const pending: VaultFolder[] = [vault.root]
  while (pending.length > 0) {
    const folder = pending.pop()!
    if (folder.id === folderId) return true
    pending.push(...folder.children)
  }
  return false
}

function fingerprintImportInput(input: string): string {
  // Two independent 32-bit accumulators make accidental collisions unlikely;
  // exact input equality remains authoritative in isCurrent().
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0
  }
  return `${input.length}:${first.toString(16)}:${second.toString(16)}`
}

function formatMiB(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}
