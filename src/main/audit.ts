import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { constants as fsConstants, promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { atomicWritePrivateFile, ensurePrivateDir } from './fileIO'
import type { AuditEventType } from './auditEventTypes'

export type { AuditEventType } from './auditEventTypes'

export interface AuditEvent {
  id: string
  timestamp: string
  type: AuditEventType
  details: AuditDetails
  previousHash: string | null
  hashScheme?: 'sha256' | 'hmac-sha256'
  hash: string
}

export type AuditDetails = Record<string, AuditValue>
type AuditValue = string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue }
export type AuditMacKey = Buffer | Uint8Array | string

export interface AuditRotationOptions {
  maxSegmentBytes?: number
  maxArchiveSegments?: number
}

interface AuditSegmentAnchor {
  file: string
  byteLength: number
  eventCount: number
  startPreviousHash: string | null
  firstHash: string | null
  lastHash: string | null
}

interface PendingAuditRotation {
  archive: AuditSegmentAnchor
}

interface AuditAnchorPayload {
  format: typeof AUDIT_ANCHOR_FORMAT
  generation: string
  maxSegmentBytes: number
  maxArchiveSegments: number
  retainedStartPreviousHash: string | null
  totalEventCount: number
  archives: AuditSegmentAnchor[]
  active: AuditSegmentAnchor
  tailHash: string | null
  pendingRotation?: PendingAuditRotation
}

export interface AuditAnchorRecord extends AuditAnchorPayload {
  hashScheme: 'hmac-sha256'
  mac: string
}

export interface VerifiedAuditLog {
  events: AuditEvent[]
  verification: { ok: true }
  anchor: AuditAnchorRecord
}

interface FileFingerprint {
  size: number
  mtimeMs: number
  ctimeMs: number
  ino: number
  dev: number
}

interface AuditFileState {
  anchor: AuditAnchorRecord
  keyIdentity: string
  fingerprints: Map<string, FileFingerprint>
}

interface ParsedSegment {
  events: AuditEvent[]
  validEnd: number
  corruptStart: number | null
  endsWithNewline: boolean
}

interface LoadedAuditLog {
  events: AuditEvent[]
  anchor: AuditAnchorRecord
}

const REDACTED = '[redacted]'
const TRUNCATED = '[truncated]'
const MAX_AUDIT_STRING = 512
const MAX_AUDIT_COLLECTION_ITEMS = 128
const MAX_AUDIT_DEPTH = 8
const MAX_AUDIT_EVENT_BYTES = 128 * 1024
const MAX_LEGACY_AUDIT_BYTES = 128 * 1024 * 1024
const MAX_ANCHOR_BYTES = 128 * 1024
const MIN_SEGMENT_BYTES = 256
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_SEGMENTS = 64
const SENSITIVE_DETAIL_KEY_RE = /(secret|token|password|authorization|credential|value)/i
const AUDIT_MAC_CONTEXT = 'vaultage audit log v1'
const AUDIT_ANCHOR_CONTEXT = 'vaultage audit anchor v1'
const AUDIT_CACHE_KEY_CONTEXT = 'vaultage audit cache identity v1'
const AUDIT_ANCHOR_FORMAT = 'vaultage.audit-anchor.v1'
const AUDIT_ANCHOR_REQUIRED_FORMAT = 'vaultage.audit-anchor-required.v1'

export const DEFAULT_AUDIT_MAX_SEGMENT_BYTES = 4 * 1024 * 1024
export const DEFAULT_AUDIT_MAX_ARCHIVE_SEGMENTS = 7

const auditFileStates = new Map<string, AuditFileState>()
const auditAppendQueues = new Map<string, Promise<void>>()

export function createAuditEvent(
  type: AuditEventType,
  details: Record<string, unknown> = {},
  previousHash: string | null = null,
  timestamp = new Date().toISOString(),
  id: string = randomUUID(),
  macKey?: AuditMacKey,
): AuditEvent {
  const eventWithoutHash = {
    id,
    timestamp,
    type,
    details: sanitizeAuditDetails(details),
    previousHash,
    hashScheme: macKey ? 'hmac-sha256' as const : 'sha256' as const,
  }
  return {
    ...eventWithoutHash,
    hash: hashAuditRecord(eventWithoutHash, macKey),
  }
}

export async function appendAuditEvent(
  filePath: string,
  type: AuditEventType,
  details: Record<string, unknown> = {},
  macKey?: AuditMacKey,
  rotationOptions: AuditRotationOptions = {},
): Promise<AuditEvent> {
  if (!macKey) throw new Error('Audit MAC key is required for durable audit events')
  validateRotationOptions(rotationOptions)

  const previous = auditAppendQueues.get(filePath) ?? Promise.resolve()
  let resolveCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve
  })
  auditAppendQueues.set(filePath, current)

  await previous.catch(() => undefined)
  try {
    return await appendAuditEventSerialized(filePath, type, details, macKey, rotationOptions)
  } finally {
    resolveCurrent()
    if (auditAppendQueues.get(filePath) === current) auditAppendQueues.delete(filePath)
  }
}

/**
 * Reads all retained records without authenticating the sidecar. Main-process
 * consumers must use readVerifiedAuditLog; this helper remains for diagnostics
 * and backwards-compatible tests that perform verification separately.
 */
export async function readAuditLog(filePath: string): Promise<AuditEvent[]> {
  try {
    const anchorPath = auditAnchorPath(filePath)
    if (!(await pathExists(anchorPath))) {
      return parseAuditLog((await readRegularFile(filePath, MAX_LEGACY_AUDIT_BYTES)).toString('utf8'))
    }
    const record = parseAnchorRecord(await readRegularFile(anchorPath, MAX_ANCHOR_BYTES), filePath)
    const events: AuditEvent[] = []
    for (const segment of [...record.archives, record.active]) {
      const raw = await readRegularFile(join(dirname(filePath), segment.file), segmentReadLimit(record))
      events.push(...parseAuditSegment(raw).events)
    }
    return events
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/**
 * Reads the bounded retained history only after authenticating the anchor and
 * every retained HMAC event. Truncation or an anchor-ahead state throws and no
 * unverified records are returned to IPC callers.
 */
export async function readVerifiedAuditLog(
  filePath: string,
  macKey: AuditMacKey,
): Promise<VerifiedAuditLog> {
  const pending = auditAppendQueues.get(filePath)
  if (pending) await pending
  const loaded = await loadAndVerifyAuditLog(filePath, macKey)
  await cacheLoadedState(filePath, loaded.anchor, macKey)
  return { ...loaded, verification: { ok: true } }
}

export function parseAuditLog(raw: string): AuditEvent[] {
  const parsed = parseAuditSegment(Buffer.from(raw, 'utf8'))
  if (parsed.corruptStart !== null) {
    const prefix = Buffer.byteLength(raw.slice(0, parsed.corruptStart), 'utf8')
    throw new Error(`Invalid audit log record near byte ${prefix}`)
  }
  return parsed.events
}

export function verifyAuditChain(
  events: AuditEvent[],
  options: {
    macKey?: AuditMacKey
    requireMac?: boolean
    initialPreviousHash?: string | null
  } = {},
): { ok: true } | { ok: false; index: number; reason: string } {
  let previousHash = options.initialPreviousHash ?? null
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (event.previousHash !== previousHash) {
      return { ok: false, index: i, reason: 'previous hash mismatch' }
    }
    const { hash, ...withoutHash } = event
    const scheme = event.hashScheme ?? 'sha256'
    if (options.requireMac && scheme !== 'hmac-sha256') {
      return { ok: false, index: i, reason: 'event MAC missing' }
    }
    if (scheme === 'hmac-sha256' && !options.macKey) {
      return { ok: false, index: i, reason: 'event MAC key unavailable' }
    }
    const expectedHash = hashAuditRecord(withoutHash, scheme === 'hmac-sha256' ? options.macKey : undefined)
    if (!safeHexEqual(expectedHash, hash)) {
      return { ok: false, index: i, reason: 'event hash mismatch' }
    }
    previousHash = hash
  }
  return { ok: true }
}

export function sanitizeAuditDetails(details: Record<string, unknown>): AuditDetails {
  return sanitizeAuditValue(details, '', 0) as AuditDetails
}

export function deriveAuditMacKey(vaultKey: Buffer): Buffer {
  return createHmac('sha256', vaultKey).update(AUDIT_MAC_CONTEXT).digest()
}

export function hashAuditRecord(record: Omit<AuditEvent, 'hash'>, macKey?: AuditMacKey): string {
  const json = stableJson(record)
  if (macKey) return createHmac('sha256', macKey).update(json).digest('hex')
  return createHash('sha256').update(json).digest('hex')
}

export function auditAnchorPath(filePath: string): string {
  return `${filePath}.anchor`
}

async function appendAuditEventSerialized(
  filePath: string,
  type: AuditEventType,
  details: Record<string, unknown>,
  macKey: AuditMacKey,
  rotationOptions: AuditRotationOptions,
): Promise<AuditEvent> {
  await ensurePrivateDir(dirname(filePath))
  let anchor = await loadAppendState(filePath, macKey)
  anchor = await applyRotationPolicy(filePath, anchor, macKey, rotationOptions)

  const event = createAuditEvent(type, details, anchor.tailHash, undefined, undefined, macKey)
  const line = Buffer.from(`${JSON.stringify(event)}\n`, 'utf8')
  if (line.length > MAX_AUDIT_EVENT_BYTES) {
    throw new Error(`Audit event exceeds ${MAX_AUDIT_EVENT_BYTES} bytes after sanitization`)
  }

  if (anchor.active.eventCount > 0 && anchor.active.byteLength + line.length > anchor.maxSegmentBytes) {
    anchor = await rotateActiveSegment(filePath, anchor, macKey)
  }

  try {
    await appendPrivateLine(filePath, line)
    const active: AuditSegmentAnchor = {
      ...anchor.active,
      byteLength: anchor.active.byteLength + line.length,
      eventCount: anchor.active.eventCount + 1,
      firstHash: anchor.active.firstHash ?? event.hash,
      lastHash: event.hash,
    }
    const next = await writeAnchor(filePath, {
      ...anchor,
      totalEventCount: anchor.totalEventCount + 1,
      active,
      tailHash: event.hash,
      pendingRotation: undefined,
    }, macKey)
    await ensureAnchorRequiredMarker(filePath, next.generation)
    await cacheLoadedState(filePath, next, macKey)
    return event
  } catch (err) {
    auditFileStates.delete(filePath)
    throw err
  }
}

async function loadAppendState(filePath: string, macKey: AuditMacKey): Promise<AuditAnchorRecord> {
  const cached = auditFileStates.get(filePath)
  const keyIdentity = auditKeyIdentity(macKey)
  if (cached && cached.keyIdentity === keyIdentity && await fingerprintsStillMatch(cached.fingerprints)) {
    return cached.anchor
  }
  const loaded = await loadAndVerifyAuditLog(filePath, macKey)
  await cacheLoadedState(filePath, loaded.anchor, macKey)
  return loaded.anchor
}

async function loadAndVerifyAuditLog(filePath: string, macKey: AuditMacKey): Promise<LoadedAuditLog> {
  await ensurePrivateDir(dirname(filePath))
  const anchorPath = auditAnchorPath(filePath)
  if (!(await pathExists(anchorPath))) return migrateLegacyAuditLog(filePath, macKey)

  let anchor = await readAndVerifyAnchor(filePath, macKey)
  await verifyOrRepairAnchorMarker(filePath, anchor.generation)
  if (anchor.pendingRotation) {
    anchor = await finishPendingRotation(filePath, anchor, macKey)
  }

  const retainedEvents: AuditEvent[] = []
  const seenIds = new Set<string>()
  let previousHash = anchor.retainedStartPreviousHash
  let globalIndex = 0

  for (const segment of anchor.archives) {
    const raw = await readRegularFile(join(dirname(filePath), segment.file), segmentReadLimit(anchor))
    const parsed = parseAuditSegment(raw)
    if (parsed.corruptStart !== null) throw integrityError(globalIndex, `corrupt archive ${segment.file}`)
    verifySegment(segment, raw, parsed.events, previousHash, macKey, globalIndex)
    addUniqueEvents(retainedEvents, seenIds, parsed.events, globalIndex)
    previousHash = segment.lastHash
    globalIndex += parsed.events.length
  }

  let activeRaw = await readRegularFile(filePath, segmentReadLimit(anchor))
  if (activeRaw.length < anchor.active.byteLength) {
    throw integrityError(globalIndex, 'active audit segment was truncated below its authenticated boundary')
  }
  const anchoredPrefix = activeRaw.subarray(0, anchor.active.byteLength)
  const prefix = parseAuditSegment(anchoredPrefix)
  if (prefix.corruptStart !== null) throw integrityError(globalIndex, 'authenticated active audit prefix is corrupt')
  verifySegment(anchor.active, anchoredPrefix, prefix.events, previousHash, macKey, globalIndex)
  addUniqueEvents(retainedEvents, seenIds, prefix.events, globalIndex)
  previousHash = anchor.active.lastHash
  globalIndex += prefix.events.length

  let suffixRaw = activeRaw.subarray(anchor.active.byteLength)
  if (suffixRaw.length > 0) {
    let suffix = parseAuditSegment(suffixRaw)
    if (suffix.corruptStart !== null) {
      const validSuffix = suffixRaw.subarray(0, suffix.validEnd)
      await quarantineAndTruncateTail(filePath, activeRaw, anchor.active.byteLength + suffix.corruptStart,
        anchor.active.byteLength + suffix.validEnd)
      suffixRaw = validSuffix
      activeRaw = Buffer.concat([anchoredPrefix, validSuffix])
      suffix = parseAuditSegment(suffixRaw)
    }
    if (suffixRaw.length > 0 && suffix.events.length === 0) {
      throw integrityError(globalIndex, 'unanchored bytes do not contain an audit event')
    }
    const suffixVerification = verifyAuditChain(suffix.events, {
      macKey,
      requireMac: true,
      initialPreviousHash: previousHash,
    })
    if (!suffixVerification.ok) {
      throw integrityError(globalIndex + suffixVerification.index,
        `unanchored audit suffix failed verification: ${suffixVerification.reason}`)
    }
    addUniqueEvents(retainedEvents, seenIds, suffix.events, globalIndex)
    if (suffix.events.length > 0) {
      if (!suffix.endsWithNewline) {
        await appendPrivateLine(filePath, Buffer.from('\n'))
        activeRaw = Buffer.concat([activeRaw, Buffer.from('\n')])
      }
      const allActiveEvents = [...prefix.events, ...suffix.events]
      const active = segmentMetadata(anchor.active.file, activeRaw, allActiveEvents, anchor.active.startPreviousHash)
      anchor = await writeAnchor(filePath, {
        ...anchor,
        totalEventCount: anchor.totalEventCount + suffix.events.length,
        active,
        tailHash: active.lastHash,
      }, macKey)
      previousHash = active.lastHash
      globalIndex += suffix.events.length
    }
  }

  const retainedCount = retainedEvents.length
  if (retainedCount > anchor.totalEventCount) {
    throw integrityError(globalIndex, 'retained event count exceeds authenticated lifetime count')
  }
  if (previousHash !== anchor.tailHash) {
    throw integrityError(globalIndex, 'audit tail does not match the authenticated anchor')
  }
  return { events: retainedEvents, anchor }
}

async function migrateLegacyAuditLog(filePath: string, macKey: AuditMacKey): Promise<LoadedAuditLog> {
  if (await pathExists(anchorRequiredPath(filePath))) {
    throw new Error('Audit anchor is missing after anchor enforcement was established')
  }

  await ensureActiveAuditFile(filePath)
  let raw = await readRegularFile(filePath, MAX_LEGACY_AUDIT_BYTES)
  let parsed = parseAuditSegment(raw)
  if (parsed.corruptStart !== null) {
    await quarantineAndTruncateTail(filePath, raw, parsed.corruptStart, parsed.validEnd)
    raw = raw.subarray(0, parsed.validEnd)
    parsed = parseAuditSegment(raw)
  }
  const migratedEvents = verifyAndRekeyLegacyAuditEvents(parsed.events, macKey)
  if (migratedEvents !== parsed.events) {
    raw = encodeAuditEvents(migratedEvents)
    await atomicWritePrivateFile(filePath, raw)
    parsed = parseAuditSegment(raw)
  }
  if (parsed.events.length > 0 && !parsed.endsWithNewline) {
    await appendPrivateLine(filePath, Buffer.from('\n'))
    raw = Buffer.concat([raw, Buffer.from('\n')])
  }

  const active = segmentMetadata(basename(filePath), raw, parsed.events, null)
  const anchor = await writeAnchor(filePath, {
    format: AUDIT_ANCHOR_FORMAT,
    generation: randomUUID(),
    maxSegmentBytes: DEFAULT_AUDIT_MAX_SEGMENT_BYTES,
    maxArchiveSegments: DEFAULT_AUDIT_MAX_ARCHIVE_SEGMENTS,
    retainedStartPreviousHash: null,
    totalEventCount: parsed.events.length,
    archives: [],
    active,
    tailHash: active.lastHash,
  }, macKey)
  await ensureAnchorRequiredMarker(filePath, anchor.generation)
  return { events: parsed.events, anchor }
}

function verifyAndRekeyLegacyAuditEvents(
  events: AuditEvent[],
  macKey: AuditMacKey,
): AuditEvent[] {
  const firstKeyedIndex = events.findIndex(event => event.hashScheme === 'hmac-sha256')
  if (firstKeyedIndex < 0 && events.length > 0) {
    throw integrityError(0, 'legacy audit migration failed: event MAC missing')
  }
  const verification = verifyAuditChain(events, { macKey })
  if (!verification.ok) {
    throw integrityError(verification.index, `legacy audit migration failed: ${verification.reason}`)
  }
  for (let index = firstKeyedIndex; index >= 0 && index < events.length; index += 1) {
    if (events[index].hashScheme !== 'hmac-sha256') {
      throw integrityError(index, 'legacy audit migration failed: event MAC missing after keyed history began')
    }
  }
  if (firstKeyedIndex <= 0) return events

  let previousHash: string | null = null
  return events.map(event => {
    const migratedWithoutHash = {
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      details: event.details,
      previousHash,
      hashScheme: 'hmac-sha256' as const,
    }
    const migrated = {
      ...migratedWithoutHash,
      hash: hashAuditRecord(migratedWithoutHash, macKey),
    }
    previousHash = migrated.hash
    return migrated
  })
}

function encodeAuditEvents(events: AuditEvent[]): Buffer {
  const lines = events.map(event => {
    const line = Buffer.from(`${JSON.stringify(event)}\n`, 'utf8')
    if (line.byteLength > MAX_AUDIT_EVENT_BYTES) {
      throw new Error(`Audit event exceeds ${MAX_AUDIT_EVENT_BYTES} bytes after migration`)
    }
    return line
  })
  const encoded = Buffer.concat(lines)
  if (encoded.byteLength > MAX_LEGACY_AUDIT_BYTES) throw new Error('Migrated audit log is too large')
  return encoded
}

async function applyRotationPolicy(
  filePath: string,
  anchor: AuditAnchorRecord,
  macKey: AuditMacKey,
  options: AuditRotationOptions,
): Promise<AuditAnchorRecord> {
  const maxSegmentBytes = options.maxSegmentBytes ?? anchor.maxSegmentBytes
  const maxArchiveSegments = options.maxArchiveSegments ?? anchor.maxArchiveSegments
  if (maxSegmentBytes === anchor.maxSegmentBytes && maxArchiveSegments === anchor.maxArchiveSegments) {
    return anchor
  }

  const trimmed = trimArchives({ ...anchor, maxSegmentBytes, maxArchiveSegments })
  const next = await writeAnchor(filePath, trimmed.anchor, macKey)
  await removeDroppedArchives(filePath, trimmed.dropped)
  return next
}

async function rotateActiveSegment(
  filePath: string,
  anchor: AuditAnchorRecord,
  macKey: AuditMacKey,
): Promise<AuditAnchorRecord> {
  if (!anchor.active.lastHash || anchor.active.eventCount === 0) return anchor
  const raw = await readRegularFile(filePath, segmentReadLimit(anchor))
  const parsed = parseAuditSegment(raw)
  if (parsed.corruptStart !== null) throw new Error('Cannot rotate a corrupt active audit segment')
  verifySegment(anchor.active, raw, parsed.events, anchor.active.startPreviousHash, macKey, 0)

  const archive: AuditSegmentAnchor = {
    ...anchor.active,
    file: archiveFileName(filePath, anchor.active.lastHash),
  }
  await writeExclusiveOrVerify(join(dirname(filePath), archive.file), raw)

  const pending = await writeAnchor(filePath, {
    ...anchor,
    pendingRotation: { archive },
  }, macKey)
  await truncatePrivateFile(filePath, 0)
  return finalizeRotation(filePath, pending, macKey)
}

async function finishPendingRotation(
  filePath: string,
  anchor: AuditAnchorRecord,
  macKey: AuditMacKey,
): Promise<AuditAnchorRecord> {
  const pending = anchor.pendingRotation
  if (!pending) return anchor
  if (!sameSegmentExceptFile(anchor.active, pending.archive)
    || pending.archive.file !== archiveFileName(filePath, anchor.active.lastHash)) {
    throw new Error('Authenticated audit rotation journal is inconsistent')
  }

  const archiveRaw = await readRegularFile(join(dirname(filePath), pending.archive.file), segmentReadLimit(anchor))
  const archiveParsed = parseAuditSegment(archiveRaw)
  if (archiveParsed.corruptStart !== null) throw new Error('Pending audit archive is corrupt')
  verifySegment(pending.archive, archiveRaw, archiveParsed.events,
    pending.archive.startPreviousHash, macKey, 0)

  const activeRaw = await readRegularFile(filePath, segmentReadLimit(anchor))
  if (activeRaw.length > 0 && !activeRaw.equals(archiveRaw)) {
    throw new Error('Active audit segment does not match its authenticated pending rotation')
  }
  if (activeRaw.length > 0) await truncatePrivateFile(filePath, 0)
  return finalizeRotation(filePath, anchor, macKey)
}

async function finalizeRotation(
  filePath: string,
  anchor: AuditAnchorRecord,
  macKey: AuditMacKey,
): Promise<AuditAnchorRecord> {
  const archive = anchor.pendingRotation?.archive
  if (!archive) throw new Error('Audit rotation is missing its authenticated journal entry')
  const candidate: AuditAnchorPayload = {
    ...anchor,
    archives: [...anchor.archives, archive],
    active: emptySegment(basename(filePath), anchor.tailHash),
    pendingRotation: undefined,
  }
  const trimmed = trimArchives(candidate)
  const next = await writeAnchor(filePath, trimmed.anchor, macKey)
  await removeDroppedArchives(filePath, trimmed.dropped)
  return next
}

function trimArchives(anchor: AuditAnchorPayload): {
  anchor: AuditAnchorPayload
  dropped: AuditSegmentAnchor[]
} {
  const excess = Math.max(0, anchor.archives.length - anchor.maxArchiveSegments)
  if (excess === 0) return { anchor, dropped: [] }
  const dropped = anchor.archives.slice(0, excess)
  const archives = anchor.archives.slice(excess)
  return {
    anchor: {
      ...anchor,
      retainedStartPreviousHash: dropped[dropped.length - 1].lastHash,
      archives,
    },
    dropped,
  }
}

async function readAndVerifyAnchor(filePath: string, macKey: AuditMacKey): Promise<AuditAnchorRecord> {
  const record = parseAnchorRecord(await readRegularFile(auditAnchorPath(filePath), MAX_ANCHOR_BYTES), filePath)
  const { mac, hashScheme: _hashScheme, ...payload } = record
  const expected = anchorMac(payload, macKey)
  if (!safeHexEqual(expected, mac)) throw new Error('Audit anchor MAC verification failed')
  return record
}

function parseAnchorRecord(raw: Buffer, filePath: string): AuditAnchorRecord {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('Audit anchor is not valid JSON')
  }
  if (!isRecord(candidate)) throw new Error('Audit anchor must be an object')
  const archives = candidate.archives
  if (candidate.format !== AUDIT_ANCHOR_FORMAT || candidate.hashScheme !== 'hmac-sha256'
    || !isUuid(candidate.generation) || !isHashOrNull(candidate.retainedStartPreviousHash)
    || !isHashOrNull(candidate.tailHash) || !isHash(candidate.mac)
    || !isNonNegativeSafeInteger(candidate.totalEventCount)
    || !isValidSegmentBytes(candidate.maxSegmentBytes)
    || !isValidArchiveCount(candidate.maxArchiveSegments)
    || !Array.isArray(archives)
    || archives.length > candidate.maxArchiveSegments
    || !archives.every(isSegment)
    || !isSegment(candidate.active)) {
    throw new Error('Audit anchor has an invalid schema')
  }
  const pendingRotationValue = candidate.pendingRotation
  let pendingRotation: PendingAuditRotation | undefined
  if (pendingRotationValue !== undefined) {
    if (!isRecord(pendingRotationValue) || !isSegment(pendingRotationValue.archive)) {
      throw new Error('Audit anchor pending rotation is invalid')
    }
    pendingRotation = { archive: pendingRotationValue.archive }
  }
  const value: AuditAnchorRecord = {
    format: candidate.format,
    generation: candidate.generation,
    maxSegmentBytes: candidate.maxSegmentBytes,
    maxArchiveSegments: candidate.maxArchiveSegments,
    retainedStartPreviousHash: candidate.retainedStartPreviousHash,
    totalEventCount: candidate.totalEventCount,
    archives,
    active: candidate.active,
    tailHash: candidate.tailHash,
    ...(pendingRotation === undefined ? {} : { pendingRotation }),
    hashScheme: candidate.hashScheme,
    mac: candidate.mac,
  }
  const activeName = basename(filePath)
  if (value.active.file !== activeName) throw new Error('Audit anchor active filename is invalid')
  for (const archive of value.archives) {
    if (!isSegment(archive) || archive.file !== archiveFileName(filePath, archive.lastHash)) {
      throw new Error('Audit anchor archive metadata is invalid')
    }
  }
  if (value.pendingRotation !== undefined
    && value.pendingRotation.archive.file !== archiveFileName(filePath, value.pendingRotation.archive.lastHash)) {
    throw new Error('Audit anchor pending rotation is invalid')
  }

  const retainedCount = value.archives.reduce((sum, segment) => sum + segment.eventCount, 0)
    + value.active.eventCount
  if (retainedCount > value.totalEventCount) throw new Error('Audit anchor event counts are inconsistent')
  let previous = value.retainedStartPreviousHash
  for (const segment of [...value.archives, value.active]) {
    if (segment.startPreviousHash !== previous) throw new Error('Audit anchor segment boundaries are inconsistent')
    previous = segment.lastHash ?? previous
  }
  if (previous !== value.tailHash) throw new Error('Audit anchor tail metadata is inconsistent')
  return value
}

async function writeAnchor(
  filePath: string,
  payloadOrRecord: AuditAnchorPayload | AuditAnchorRecord,
  macKey: AuditMacKey,
): Promise<AuditAnchorRecord> {
  let payload: AuditAnchorPayload
  if ('mac' in payloadOrRecord) {
    const { mac: _mac, hashScheme: _hashScheme, ...recordPayload } = payloadOrRecord
    payload = recordPayload
  } else {
    payload = payloadOrRecord
  }
  const record: AuditAnchorRecord = {
    ...payload,
    hashScheme: 'hmac-sha256',
    mac: anchorMac(payload, macKey),
  }
  await atomicWritePrivateFile(auditAnchorPath(filePath), `${JSON.stringify(record)}\n`)
  return record
}

function anchorMac(payload: AuditAnchorPayload, macKey: AuditMacKey): string {
  return createHmac('sha256', macKey)
    .update(AUDIT_ANCHOR_CONTEXT)
    .update('\0')
    .update(stableJson(payload))
    .digest('hex')
}

function segmentMetadata(
  file: string,
  raw: Buffer,
  events: AuditEvent[],
  startPreviousHash: string | null,
): AuditSegmentAnchor {
  return {
    file,
    byteLength: raw.length,
    eventCount: events.length,
    startPreviousHash,
    firstHash: events[0]?.hash ?? null,
    lastHash: events.at(-1)?.hash ?? null,
  }
}

function emptySegment(file: string, previousHash: string | null): AuditSegmentAnchor {
  return {
    file,
    byteLength: 0,
    eventCount: 0,
    startPreviousHash: previousHash,
    firstHash: null,
    lastHash: null,
  }
}

function verifySegment(
  segment: AuditSegmentAnchor,
  raw: Buffer,
  events: AuditEvent[],
  expectedPreviousHash: string | null,
  macKey: AuditMacKey,
  globalIndex: number,
): void {
  if (segment.byteLength !== raw.length || segment.eventCount !== events.length
    || segment.startPreviousHash !== expectedPreviousHash
    || segment.firstHash !== (events[0]?.hash ?? null)
    || segment.lastHash !== (events.at(-1)?.hash ?? null)) {
    throw integrityError(globalIndex, `audit segment metadata mismatch for ${segment.file}`)
  }
  if (raw.length > 0 && raw.at(-1) !== 0x0a) {
    throw integrityError(globalIndex, `audit segment ${segment.file} is missing its durable newline`)
  }
  const verification = verifyAuditChain(events, {
    macKey,
    requireMac: true,
    initialPreviousHash: expectedPreviousHash,
  })
  if (!verification.ok) {
    throw integrityError(globalIndex + verification.index,
      `audit segment ${segment.file} failed verification: ${verification.reason}`)
  }
}

function parseAuditSegment(raw: Buffer): ParsedSegment {
  const events: AuditEvent[] = []
  let offset = 0
  let validEnd = 0
  while (offset < raw.length) {
    const newline = raw.indexOf(0x0a, offset)
    const lineEnd = newline === -1 ? raw.length : newline
    const nextOffset = newline === -1 ? raw.length : newline + 1
    const line = raw.subarray(offset, lineEnd).toString('utf8').trim()
    if (line) {
      try {
        events.push(parseAuditEvent(line))
      } catch {
        return {
          events,
          validEnd,
          corruptStart: offset,
          endsWithNewline: raw.length === 0 || raw.at(-1) === 0x0a,
        }
      }
    }
    validEnd = nextOffset
    offset = nextOffset
  }
  return {
    events,
    validEnd,
    corruptStart: null,
    endsWithNewline: raw.length === 0 || raw.at(-1) === 0x0a,
  }
}

function parseAuditEvent(line: string): AuditEvent {
  const event = JSON.parse(line) as Partial<AuditEvent>
  if (!event || typeof event !== 'object'
    || typeof event.id !== 'string' || event.id.length === 0 || event.id.length > 256
    || typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp))
    || typeof event.type !== 'string' || event.type.length === 0 || event.type.length > 128
    || !isRecord(event.details)
    || !isHashOrNull(event.previousHash)
    || (event.hashScheme !== undefined && event.hashScheme !== 'sha256' && event.hashScheme !== 'hmac-sha256')
    || !isHash(event.hash)) {
    throw new Error('record has an invalid audit-event schema')
  }
  return event as AuditEvent
}

function sanitizeAuditValue(value: unknown, key: string, depth: number): AuditValue {
  if (SENSITIVE_DETAIL_KEY_RE.test(key)) return REDACTED
  if (depth > MAX_AUDIT_DEPTH) return TRUNCATED
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') {
    return value.length > MAX_AUDIT_STRING ? `${value.slice(0, MAX_AUDIT_STRING)}...` : value
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_AUDIT_COLLECTION_ITEMS)
      .map(item => sanitizeAuditValue(item, key, depth + 1))
    if (value.length > items.length) items.push(`[truncated ${value.length - items.length} items]`)
    return items
  }
  if (value && typeof value === 'object') {
    const out: Record<string, AuditValue> = {}
    const entries = Object.entries(value).slice(0, MAX_AUDIT_COLLECTION_ITEMS)
    for (const [childKey, childValue] of entries) {
      out[childKey] = sanitizeAuditValue(childValue, childKey, depth + 1)
    }
    if (Object.keys(value).length > entries.length) out.__truncated__ = true
    return out
  }
  return String(value)
}

async function quarantineAndTruncateTail(
  filePath: string,
  raw: Buffer,
  corruptStart: number,
  validEnd: number,
): Promise<void> {
  const corruptTail = raw.subarray(corruptStart)
  const recoveryPath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`
  await writeExclusiveOrVerify(recoveryPath, corruptTail)
  await truncatePrivateFile(filePath, validEnd)
}

async function appendPrivateLine(filePath: string, data: Buffer): Promise<void> {
  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
  const handle = await fs.open(filePath,
    fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | noFollow, 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmodPrivate(filePath)
}

async function truncatePrivateFile(filePath: string, size: number): Promise<void> {
  const stat = await fs.lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Audit path is not a regular file: ${filePath}`)
  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
  const handle = await fs.open(filePath, fsConstants.O_WRONLY | noFollow)
  try {
    await handle.truncate(size)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmodPrivate(filePath)
}

async function writeExclusiveOrVerify(filePath: string, data: Buffer): Promise<void> {
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(filePath, 'wx', 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = null
    await chmodPrivate(filePath)
    await fsyncDirectory(dirname(filePath))
  } catch (err) {
    if (handle) await handle.close().catch(() => undefined)
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    const existing = await readRegularFile(filePath, Math.max(data.length, 1))
    if (!existing.equals(data)) throw new Error(`Existing audit recovery file does not match: ${filePath}`)
  }
}

async function readRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
  if (process.platform === 'win32') {
    const linkStat = await fs.lstat(filePath)
    if (linkStat.isSymbolicLink()) throw new Error(`Audit path is not a regular file: ${filePath}`)
  }
  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Audit path is not a regular file: ${filePath}`)
    if (stat.size > maxBytes) throw new Error(`Audit file exceeds its ${maxBytes}-byte read limit: ${filePath}`)
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function ensureActiveAuditFile(filePath: string): Promise<void> {
  try {
    const handle = await fs.open(filePath, 'wx', 0o600)
    await handle.sync()
    await handle.close()
    await fsyncDirectory(dirname(filePath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    const stat = await fs.lstat(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Audit log is not a regular file')
  }
  await chmodPrivate(filePath)
}

async function ensureAnchorRequiredMarker(filePath: string, generation: string): Promise<void> {
  const markerPath = anchorRequiredPath(filePath)
  const expected = `${JSON.stringify({ format: AUDIT_ANCHOR_REQUIRED_FORMAT, generation })}\n`
  try {
    const current = await readRegularFile(markerPath, 1024)
    if (current.toString('utf8') !== expected) throw new Error('Audit anchor-required marker is inconsistent')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    await atomicWritePrivateFile(markerPath, expected)
  }
}

async function verifyOrRepairAnchorMarker(filePath: string, generation: string): Promise<void> {
  await ensureAnchorRequiredMarker(filePath, generation)
}

async function removeDroppedArchives(filePath: string, dropped: AuditSegmentAnchor[]): Promise<void> {
  for (const segment of dropped) {
    await fs.rm(join(dirname(filePath), segment.file), { force: true })
  }
  if (dropped.length > 0) await fsyncDirectory(dirname(filePath))
}

async function cacheLoadedState(
  filePath: string,
  anchor: AuditAnchorRecord,
  macKey: AuditMacKey,
): Promise<void> {
  const paths = [
    ...anchor.archives.map(segment => join(dirname(filePath), segment.file)),
    filePath,
    auditAnchorPath(filePath),
    anchorRequiredPath(filePath),
  ]
  const fingerprints = new Map<string, FileFingerprint>()
  for (const path of paths) fingerprints.set(path, await fileFingerprint(path))
  auditFileStates.set(filePath, { anchor, keyIdentity: auditKeyIdentity(macKey), fingerprints })
}

async function fingerprintsStillMatch(expected: Map<string, FileFingerprint>): Promise<boolean> {
  try {
    for (const [path, fingerprint] of expected) {
      const current = await fileFingerprint(path)
      if (current.size !== fingerprint.size || current.mtimeMs !== fingerprint.mtimeMs
        || current.ctimeMs !== fingerprint.ctimeMs || current.ino !== fingerprint.ino
        || current.dev !== fingerprint.dev) return false
    }
    return true
  } catch {
    return false
  }
}

async function fileFingerprint(path: string): Promise<FileFingerprint> {
  const stat = await fs.lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Audit path is not a regular file: ${path}`)
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    ino: stat.ino,
    dev: stat.dev,
  }
}

function auditKeyIdentity(macKey: AuditMacKey): string {
  return createHmac('sha256', macKey).update(AUDIT_CACHE_KEY_CONTEXT).digest('hex')
}

function archiveFileName(filePath: string, lastHash: string | null): string {
  if (!isHash(lastHash)) throw new Error('Audit archive requires a valid tail hash')
  return `${basename(filePath)}.segment-${lastHash}.jsonl`
}

function anchorRequiredPath(filePath: string): string {
  return `${filePath}.anchor-required`
}

function segmentReadLimit(
  anchor: Pick<AuditAnchorPayload, 'maxSegmentBytes' | 'active' | 'archives'>,
): number {
  return Math.max(
    anchor.maxSegmentBytes + MAX_AUDIT_EVENT_BYTES + 1,
    anchor.active.byteLength,
    ...anchor.archives.map(segment => segment.byteLength),
  )
}

function sameSegmentExceptFile(a: AuditSegmentAnchor, b: AuditSegmentAnchor): boolean {
  return a.byteLength === b.byteLength && a.eventCount === b.eventCount
    && a.startPreviousHash === b.startPreviousHash && a.firstHash === b.firstHash
    && a.lastHash === b.lastHash
}

function addUniqueEvents(
  target: AuditEvent[],
  seenIds: Set<string>,
  events: AuditEvent[],
  globalIndex: number,
): void {
  for (const [index, event] of events.entries()) {
    if (seenIds.has(event.id)) throw integrityError(globalIndex + index, 'duplicate audit event id')
    seenIds.add(event.id)
    target.push(event)
  }
}

function validateRotationOptions(options: AuditRotationOptions): void {
  if (options.maxSegmentBytes !== undefined && !isValidSegmentBytes(options.maxSegmentBytes)) {
    throw new Error(`maxSegmentBytes must be an integer between ${MIN_SEGMENT_BYTES} and ${MAX_SEGMENT_BYTES}`)
  }
  if (options.maxArchiveSegments !== undefined && !isValidArchiveCount(options.maxArchiveSegments)) {
    throw new Error(`maxArchiveSegments must be an integer between 1 and ${MAX_ARCHIVE_SEGMENTS}`)
  }
}

function isSegment(value: unknown): value is AuditSegmentAnchor {
  if (!isRecord(value)) return false
  return typeof value.file === 'string' && value.file.length > 0 && value.file === basename(value.file)
    && typeof value.byteLength === 'number' && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
    && value.byteLength <= MAX_LEGACY_AUDIT_BYTES
    && typeof value.eventCount === 'number' && Number.isSafeInteger(value.eventCount) && value.eventCount >= 0
    && isHashOrNull(value.startPreviousHash) && isHashOrNull(value.firstHash) && isHashOrNull(value.lastHash)
    && ((value.eventCount === 0 && value.firstHash === null && value.lastHash === null && value.byteLength === 0)
      || (value.eventCount > 0 && isHash(value.firstHash) && isHash(value.lastHash) && value.byteLength > 0))
}

function isValidSegmentBytes(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= MIN_SEGMENT_BYTES
    && (value as number) <= MAX_SEGMENT_BYTES
}

function isValidArchiveCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
    && (value as number) <= MAX_ARCHIVE_SEGMENTS
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isHashOrNull(value: unknown): value is string | null {
  return value === null || isHash(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeHexEqual(a: string, b: string): boolean {
  if (!isHash(a) || !isHash(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

function integrityError(index: number, reason: string): Error {
  return new Error(`Audit integrity verification failed at retained event ${index + 1}: ${reason}`)
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) throw new TypeError('Stable JSON objects must be plain records')
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
  return `{${entries.join(',')}}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (err) {
    if (isRecord(err) && err.code === 'ENOENT') return false
    throw err
  }
}

async function chmodPrivate(path: string): Promise<void> {
  if (process.platform !== 'win32') await fs.chmod(path, 0o600)
}

async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(path, 'r')
    await handle.sync()
  } catch (error) {
    if (!isRecord(error) || !['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF'].includes(String(error.code))) {
      throw error
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}
