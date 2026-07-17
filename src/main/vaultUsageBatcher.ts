import { createHmac, randomUUID } from 'crypto'
import { Buffer } from 'buffer'
import { validateVaultSaveJson } from './security'
import { trackSecretUsageBatchInVault, type SecretUsageDelta } from './vaultMutations'
import { redactVaultForRenderer } from './vaultRedaction'
import { VaultSessionChangedError } from './vaultSessionKey'
import { isRecord, vaultRevisionFrom } from './vaultIpcCommon'
import type { VaultChangedEvent } from '../shared/vaultIpcContracts'

export const DEFAULT_USAGE_FLUSH_INTERVAL_MS = 1_500
export const DEFAULT_USAGE_FLUSH_EVENT_LIMIT = 64
export const MAX_RECENT_USAGE_BATCH_IDS = 32

const USAGE_BINDING_CONTEXT = 'vaultage usage batching v1'
const INTERNAL_STATE_KEY = '_vaultage'
const APPLIED_BATCHES_KEY = 'recentUsageBatches'

type UpdateVault = typeof import('./vaultStorage').updateVault

export interface VaultUsageBatcherDeps {
  getVaultKey: () => Buffer | null
  getSessionEpoch: () => number
  getVaultRevision: () => number
  setVaultRevision: (revision: number) => void
  onVaultChanged: (change: VaultChangedEvent) => void
  updateVault: UpdateVault
  flushIntervalMs?: number
  flushEventLimit?: number
  now?: () => Date
  onBackgroundError?: (error: unknown) => void
  onDroppedUsage?: (eventCount: number, reason: string) => void
}

export interface UsageFlushResult {
  batches: number
  eventCount: number
  appliedCount: number
  missingSecretIds: string[]
  revision?: number
}

interface UsageBucket {
  id: string
  binding: string
  deltas: Map<string, { count: number; lastUsedAt: string }>
  eventCount: number
  attempted: boolean
}

interface CommittedUsageBatch {
  revision: number
  data: unknown
  appliedCount: number
  missingSecretIds: string[]
  alreadyApplied: boolean
}

/**
 * Aggregates high-frequency usage metadata and commits it in bounded batches.
 *
 * Each batch carries a persisted idempotency marker. This matters because a
 * session can be invalidated after an atomic rename succeeds but before the
 * caller observes success; retrying that ambiguous commit must not increment
 * counters twice.
 */
export class VaultUsageBatcher {
  private readonly updateVault: UpdateVault
  private readonly flushIntervalMs: number
  private readonly flushEventLimit: number
  private readonly now: () => Date
  private buckets: UsageBucket[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private backgroundFlushQueued = false
  private flushTail: Promise<void> = Promise.resolve()

  constructor(private readonly deps: VaultUsageBatcherDeps) {
    this.updateVault = deps.updateVault
    this.flushIntervalMs = positiveInteger(deps.flushIntervalMs, DEFAULT_USAGE_FLUSH_INTERVAL_MS)
    this.flushEventLimit = positiveInteger(deps.flushEventLimit, DEFAULT_USAGE_FLUSH_EVENT_LIMIT)
    this.now = deps.now ?? (() => new Date())
  }

  record(secretId: string, usedAt = this.now().toISOString()): void {
    validateSecretId(secretId)
    validateUsedAt(usedAt)
    const key = this.deps.getVaultKey()
    if (!key) throw new VaultSessionChangedError()
    const binding = usageBinding(key)
    this.dropBucketsForOtherVaults(binding)

    let bucket = this.buckets.at(-1)
    if (!bucket || bucket.binding !== binding || bucket.attempted) {
      bucket = {
        id: randomUUID(),
        binding,
        deltas: new Map(),
        eventCount: 0,
        attempted: false,
      }
      this.buckets.push(bucket)
    }

    const current = bucket.deltas.get(secretId)
    bucket.deltas.set(secretId, {
      count: Math.min(Number.MAX_SAFE_INTEGER, (current?.count ?? 0) + 1),
      lastUsedAt: laterTimestamp(current?.lastUsedAt, usedAt),
    })
    bucket.eventCount = Math.min(Number.MAX_SAFE_INTEGER, bucket.eventCount + 1)

    if (this.pendingEventCount() >= this.flushEventLimit) {
      this.clearTimer()
      this.queueBackgroundFlush()
    } else {
      this.scheduleFlush()
    }
  }

  pendingEventCount(): number {
    return this.buckets.reduce((sum, bucket) => sum + bucket.eventCount, 0)
  }

  pendingBatchCount(): number {
    return this.buckets.length
  }

  /**
   * Applies pending optimistic usage metadata to a renderer-safe snapshot.
   * Existing values remain redacted; only counters and timestamps are changed.
   */
  decorateSnapshot(snapshot: unknown): unknown {
    if (this.buckets.length === 0) return snapshot
    const deltas = aggregateDeltas(this.buckets)
    if (deltas.length === 0) return snapshot
    try {
      return trackSecretUsageBatchInVault(snapshot, deltas).vault
    } catch {
      return snapshot
    }
  }

  /** Flushes every batch that was pending when this call entered the queue. */
  flush(): Promise<UsageFlushResult> {
    this.clearTimer()
    const run = this.flushTail.then(
      () => this.flushCapturedBatches(),
      () => this.flushCapturedBatches(),
    )
    this.flushTail = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Drops queued metadata explicitly. Normal lock paths should call flush()
   * first; this is reserved for vault replacement/sign-out boundaries.
   */
  discard(reason: string): number {
    this.clearTimer()
    const count = this.pendingEventCount()
    this.buckets = []
    if (count > 0) this.deps.onDroppedUsage?.(count, reason)
    return count
  }

  private async flushCapturedBatches(): Promise<UsageFlushResult> {
    const targetIds = new Set(this.buckets.map(bucket => bucket.id))
    const total: UsageFlushResult = {
      batches: 0,
      eventCount: 0,
      appliedCount: 0,
      missingSecretIds: [],
    }

    while (true) {
      const bucket = this.buckets.find(candidate => targetIds.has(candidate.id))
      if (!bucket) break
      bucket.attempted = true
      const result = await this.commitBucket(bucket)
      const index = this.buckets.indexOf(bucket)
      if (index >= 0) this.buckets.splice(index, 1)
      const currentRevision = this.deps.getVaultRevision()
      if (result.revision >= currentRevision) {
        this.deps.setVaultRevision(result.revision)
        this.deps.onVaultChanged({
          revision: result.revision,
          data: result.data,
          source: result.alreadyApplied ? 'usage-batch-recovered' : 'usage-batch',
        })
      }
      total.batches += 1
      total.eventCount += bucket.eventCount
      total.appliedCount += result.appliedCount
      total.missingSecretIds.push(...result.missingSecretIds)
      total.revision = Math.max(total.revision ?? 0, result.revision)
    }

    if (this.buckets.length > 0) this.scheduleFlush()
    return total
  }

  private async commitBucket(bucket: UsageBucket): Promise<CommittedUsageBatch> {
    const key = this.deps.getVaultKey()
    if (!key || usageBinding(key) !== bucket.binding) throw new VaultSessionChangedError()
    const epoch = this.deps.getSessionEpoch()
    const assertCurrent = () => {
      const currentKey = this.deps.getVaultKey()
      if (
        this.deps.getSessionEpoch() !== epoch ||
        !currentKey ||
        usageBinding(currentKey) !== bucket.binding
      ) {
        throw new VaultSessionChangedError()
      }
    }
    const deltas: SecretUsageDelta[] = [...bucket.deltas].map(([secretId, delta]) => ({
      secretId,
      count: delta.count,
      lastUsedAt: delta.lastUsedAt,
    }))

    const result = await this.updateVault(key, (vault) => {
      const current = isRecord(vault) ? vault : {}
      const currentRevision = vaultRevisionFrom(current, this.deps.getVaultRevision())
      if (appliedBatchIds(current).includes(bucket.id)) {
        return {
          json: validateVaultSaveJson(JSON.stringify(current)),
          result: {
            revision: currentRevision,
            data: redactVaultForRenderer(current),
            appliedCount: 0,
            missingSecretIds: [],
            alreadyApplied: true,
          },
        }
      }

      const applied = trackSecretUsageBatchInVault(current, deltas)
      const nextRevision = currentRevision + 1
      const next = withAppliedBatchId({
        ...(applied.vault as Record<string, unknown>),
        revision: nextRevision,
      }, bucket.id, nextRevision)
      return {
        json: validateVaultSaveJson(JSON.stringify(next)),
        result: {
          revision: nextRevision,
          data: redactVaultForRenderer(next),
          appliedCount: applied.appliedCount,
          missingSecretIds: applied.missingSecretIds,
          alreadyApplied: false,
        },
      }
    }, { assertCurrent })

    return result
  }

  private dropBucketsForOtherVaults(binding: string): void {
    const dropped = this.buckets.filter(bucket => bucket.binding !== binding)
    if (dropped.length === 0) return
    const count = dropped.reduce((sum, bucket) => sum + bucket.eventCount, 0)
    this.buckets = this.buckets.filter(bucket => bucket.binding === binding)
    this.deps.onDroppedUsage?.(count, 'vault-session-key-changed')
  }

  private scheduleFlush(): void {
    if (this.timer || this.buckets.length === 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.queueBackgroundFlush()
    }, this.flushIntervalMs)
    this.timer.unref?.()
  }

  private runBackgroundFlush(): void {
    void this.flush().catch((error) => {
      this.deps.onBackgroundError?.(error)
      if (this.deps.getVaultKey()) this.scheduleFlush()
    })
  }

  private queueBackgroundFlush(): void {
    if (this.backgroundFlushQueued) return
    this.backgroundFlushQueued = true
    queueMicrotask(() => {
      this.backgroundFlushQueued = false
      this.runBackgroundFlush()
    })
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

export function isUsageOnlyRevisionRange(
  vault: unknown,
  expectedRevision: number,
  currentRevision: number,
): boolean {
  if (!isRecord(vault) || !Number.isInteger(expectedRevision) || !Number.isInteger(currentRevision)) return false
  if (expectedRevision >= currentRevision || currentRevision - expectedRevision > MAX_RECENT_USAGE_BATCH_IDS) return false
  const revisions = new Set(appliedBatchMarkers(vault).map(marker => marker.revision))
  for (let revision = expectedRevision + 1; revision <= currentRevision; revision += 1) {
    if (!revisions.has(revision)) return false
  }
  return true
}

function withAppliedBatchId(
  vault: Record<string, unknown>,
  batchId: string,
  revision: number,
): Record<string, unknown> {
  const internal = isRecord(vault[INTERNAL_STATE_KEY]) ? vault[INTERNAL_STATE_KEY] : {}
  const batches = [
    ...appliedBatchMarkers(vault).filter(marker => marker.id !== batchId),
    { id: batchId, revision },
  ]
    .slice(-MAX_RECENT_USAGE_BATCH_IDS)
  return {
    ...vault,
    [INTERNAL_STATE_KEY]: {
      ...internal,
      [APPLIED_BATCHES_KEY]: batches,
    },
  }
}

function appliedBatchIds(vault: Record<string, unknown>): string[] {
  return appliedBatchMarkers(vault).map(marker => marker.id)
}

function appliedBatchMarkers(vault: Record<string, unknown>): Array<{ id: string; revision: number }> {
  const internal = isRecord(vault[INTERNAL_STATE_KEY]) ? vault[INTERNAL_STATE_KEY] : null
  const raw = internal?.[APPLIED_BATCHES_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is { id: string; revision: number } => (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-f0-9-]{16,80}$/i.test(value.id) &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0
  ))
    .slice(-MAX_RECENT_USAGE_BATCH_IDS)
}

function aggregateDeltas(buckets: readonly UsageBucket[]): SecretUsageDelta[] {
  const aggregated = new Map<string, { count: number; lastUsedAt: string }>()
  for (const bucket of buckets) {
    for (const [secretId, delta] of bucket.deltas) {
      const current = aggregated.get(secretId)
      aggregated.set(secretId, {
        count: Math.min(Number.MAX_SAFE_INTEGER, (current?.count ?? 0) + delta.count),
        lastUsedAt: laterTimestamp(current?.lastUsedAt, delta.lastUsedAt),
      })
    }
  }
  return [...aggregated].map(([secretId, delta]) => ({ secretId, ...delta }))
}

function usageBinding(key: Buffer): string {
  return createHmac('sha256', key).update(USAGE_BINDING_CONTEXT).digest('hex')
}

function validateSecretId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Invalid secret id')
  }
}

function validateUsedAt(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid usage timestamp')
  }
}

function laterTimestamp(current: string | undefined, candidate: string): string {
  if (!current || Number.isNaN(Date.parse(current))) return candidate
  return Date.parse(candidate) >= Date.parse(current) ? candidate : current
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}
