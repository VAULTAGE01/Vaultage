import { describe, expect, it, vi } from 'vitest'
import { AuditFailureGuard, type AuditFailureGuardDeps } from './auditFailureGuard'

describe('AuditFailureGuard', () => {
  it('preserves the first error, notifies once, and coalesces concurrent locks', async () => {
    let releaseLock!: () => void
    const lockVault = vi.fn(() => new Promise<void>((resolve) => { releaseLock = resolve }))
    const h = harness({ lockVault })

    h.guard.markFailed(new Error('first integrity failure'))
    h.guard.markFailed(new Error('later disk failure'))

    expect(h.guard.isBlocked).toBe(true)
    expect(h.guard.firstFailure?.message).toBe('first integrity failure')
    expect(h.notifyUser).not.toHaveBeenCalled()
    expect(h.logFailure).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(lockVault).toHaveBeenCalledTimes(1))
    releaseLock()
    await vi.waitFor(() => expect(h.notifyUser).toHaveBeenCalledTimes(1))
    expect(h.notifyUser).toHaveBeenCalledWith(h.guard.firstFailure)
    await vi.waitFor(() => expect(h.logLockFailure).not.toHaveBeenCalled())
  })

  it('suppresses ordinary events while blocked and permits an unlock recovery probe', () => {
    const h = harness()
    h.guard.markFailed(new Error('audit unavailable'))

    expect(h.guard.shouldAttempt('provider.action')).toBe(false)
    expect(h.guard.shouldAttempt('vault.lock')).toBe(false)
    expect(h.guard.shouldAttempt('vault.unlock')).toBe(true)
    expect(h.guard.markSucceeded('provider.action')).toBe(false)
    expect(h.guard.isBlocked).toBe(true)
    expect(h.guard.markSucceeded('vault.unlock')).toBe(true)
    expect(h.guard.isBlocked).toBe(false)
    expect(h.guard.firstFailure?.message).toBe('audit unavailable')
  })

  it('locks again after a failed recovery probe but never replaces the diagnostic root cause', async () => {
    const h = harness()
    h.guard.markFailed(new Error('original truncation'))
    await vi.waitFor(() => expect(h.lockVault).toHaveBeenCalledTimes(1))
    h.guard.markFailed(new Error('unlock probe also failed'))
    await vi.waitFor(() => expect(h.lockVault).toHaveBeenCalledTimes(2))

    expect(h.guard.firstFailure?.message).toBe('original truncation')
    expect(h.notifyUser).toHaveBeenCalledTimes(1)
  })
})

function harness(overrides: Partial<AuditFailureGuardDeps> = {}): {
  guard: AuditFailureGuard
  lockVault: ReturnType<typeof vi.fn>
  notifyUser: ReturnType<typeof vi.fn>
  logFailure: ReturnType<typeof vi.fn>
  logLockFailure: ReturnType<typeof vi.fn>
} {
  const lockVault = vi.fn().mockResolvedValue(undefined)
  const notifyUser = vi.fn()
  const logFailure = vi.fn()
  const logLockFailure = vi.fn()
  const guard = new AuditFailureGuard({
    lockVault,
    notifyUser,
    logFailure,
    logLockFailure,
    ...overrides,
  })
  return { guard, lockVault, notifyUser, logFailure, logLockFailure }
}
