import { describe, expect, it } from 'vitest'
import { IdleAutoLockController } from './idleAutoLock'

describe('IdleAutoLockController', () => {
  it('locks an unlocked vault after the idle threshold', () => {
    const lockReasons: string[] = []
    const controller = new IdleAutoLockController({
      isUnlocked: () => true,
      getSystemIdleSeconds: () => 900,
      lock: reason => lockReasons.push(reason),
      idleSeconds: 600,
    })

    controller.check()

    expect(lockReasons).toEqual(['idle-timeout'])
  })

  it('does not lock while the vault is locked or recently active', () => {
    const lockReasons: string[] = []
    const lockedController = new IdleAutoLockController({
      isUnlocked: () => false,
      getSystemIdleSeconds: () => 900,
      lock: reason => lockReasons.push(reason),
      idleSeconds: 600,
    })
    const activeController = new IdleAutoLockController({
      isUnlocked: () => true,
      getSystemIdleSeconds: () => 120,
      lock: reason => lockReasons.push(reason),
      idleSeconds: 600,
    })

    lockedController.check()
    activeController.check()

    expect(lockReasons).toEqual([])
  })
})
