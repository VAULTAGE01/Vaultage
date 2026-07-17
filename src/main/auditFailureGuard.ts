import type { AuditEventType } from './audit'

export interface AuditFailureGuardDeps {
  lockVault: () => Promise<void>
  notifyUser: (firstError: Error) => void
  logFailure: (error: Error, firstError: Error) => void
  logLockFailure: (error: Error, firstError: Error) => void
}

/**
 * Converts an asynchronous audit durability/integrity failure into a one-shot
 * security lock. The first failure is retained for diagnosis, queued ordinary
 * events are suppressed, and only setup/unlock may probe for recovery.
 */
export class AuditFailureGuard {
  private firstError: Error | null = null
  private blocked = false
  private lockPromise: Promise<void> | null = null

  constructor(private readonly deps: AuditFailureGuardDeps) {}

  shouldAttempt(type: AuditEventType): boolean {
    return !this.blocked || isRecoveryEvent(type)
  }

  markSucceeded(type: AuditEventType): boolean {
    if (!this.blocked || !isRecoveryEvent(type)) return false
    this.blocked = false
    return true
  }

  markFailed(reason: unknown): void {
    const error = toError(reason)
    const isFirstFailure = this.firstError === null
    if (isFirstFailure) this.firstError = error
    this.blocked = true
    const firstError = this.firstError!

    safely(() => this.deps.logFailure(error, firstError))
    if (!this.lockPromise) {
      this.lockPromise = Promise.resolve()
        .then(() => this.deps.lockVault())
        .catch((lockError) => {
          safely(() => this.deps.logLockFailure(toError(lockError), firstError))
        })
        .finally(() => {
          this.lockPromise = null
        })
    }
    if (isFirstFailure) {
      // Never let a synchronous/native error dialog delay the security lock.
      const lockAttempt = this.lockPromise
      void lockAttempt.then(() => safely(() => this.deps.notifyUser(firstError)))
    }
  }

  get firstFailure(): Error | null {
    return this.firstError
  }

  get isBlocked(): boolean {
    return this.blocked
  }
}

function isRecoveryEvent(type: AuditEventType): boolean {
  return type === 'vault.setup' || type === 'vault.unlock'
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function safely(callback: () => void): void {
  try {
    callback()
  } catch {
    // Failure reporting must never prevent the security lock from running.
  }
}
