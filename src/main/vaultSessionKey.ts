import { Buffer } from 'buffer'

const SESSION_KEY_BINDING = Symbol('vaultage.session-key-binding')

interface SessionKeyBinding {
  owner: VaultSessionKeyring
  epoch: number
}

type BoundBuffer = Buffer & {
  [SESSION_KEY_BINDING]?: SessionKeyBinding
}

export class VaultSessionChangedError extends Error {
  readonly code = 'VAULT_SESSION_CHANGED'

  constructor() {
    super('Vault session changed; unlock and try again')
  }
}

export interface VaultSessionOperation {
  readonly epoch: number
  assertCurrent(): void
  release(): void
}

export interface VaultKeyLease extends VaultSessionOperation {
  readonly key: Buffer
}

/**
 * Owns the sole long-lived vault-key Buffer.
 *
 * Async work receives a zeroizable copy through a lease. Invalidating the
 * session immediately makes every lease fail its next commit check, while the
 * copied bytes remain intact until the operation releases them. This avoids
 * mutating a Buffer that an in-flight crypto operation is still reading.
 */
export class VaultSessionKeyring {
  private key: BoundBuffer | null = null
  private epochValue = 0
  private activeOperations = 0
  private invalidating = false
  private idleWaiters: Array<() => void> = []
  private invalidationPromise: Promise<boolean> | null = null

  get epoch(): number {
    return this.epochValue
  }

  isUnlocked(): boolean {
    return Boolean(this.key) && !this.invalidating
  }

  /**
   * Only expose this reference to synchronous code or storage functions that
   * immediately turn it into a lease. It is intentionally branded so storage
   * can reject it after the owning session changes.
   */
  currentKey(): Buffer | null {
    return this.invalidating ? null : this.key
  }

  beginOperation(): VaultSessionOperation | null {
    if (this.invalidating) return null
    const epoch = this.epochValue
    this.activeOperations += 1
    let released = false
    return {
      epoch,
      assertCurrent: () => {
        if (released || this.invalidating || this.epochValue !== epoch) {
          throw new VaultSessionChangedError()
        }
      },
      release: () => {
        if (released) return
        released = true
        this.releaseOperation()
      },
    }
  }

  leaseCurrentKey(): VaultKeyLease | null {
    const key = this.currentKey()
    return key ? this.leaseBoundKey(key) : null
  }

  installKey(key: Buffer, expectedEpoch: number): boolean {
    if (this.invalidating || this.epochValue !== expectedEpoch) return false

    this.key?.fill(0)
    this.epochValue += 1
    const owned = Buffer.from(key) as BoundBuffer
    Object.defineProperty(owned, SESSION_KEY_BINDING, {
      value: { owner: this, epoch: this.epochValue },
      configurable: false,
      enumerable: false,
      writable: false,
    })
    this.key = owned
    return true
  }

  /**
   * Invalidates every in-flight operation while preserving the unlocked key.
   * Active-vault switches use this as a synchronous authorization boundary:
   * work admitted for vault A cannot pass a later commit or plaintext-release
   * assertion after vault B becomes the selected scope.
   */
  rotateScope(): boolean {
    if (this.invalidating || !this.key) return false
    const previous = this.key
    this.epochValue += 1
    const owned = Buffer.from(previous) as BoundBuffer
    Object.defineProperty(owned, SESSION_KEY_BINDING, {
      value: { owner: this, epoch: this.epochValue },
      configurable: false,
      enumerable: false,
      writable: false,
    })
    this.key = owned
    previous.fill(0)
    return true
  }

  async invalidate(): Promise<boolean> {
    if (this.invalidationPromise) return this.invalidationPromise

    const wasUnlocked = Boolean(this.key)
    this.invalidating = true
    this.epochValue += 1
    this.key?.fill(0)
    this.key = null

    const pending = (async () => {
      if (this.activeOperations > 0) {
        await new Promise<void>(resolve => this.idleWaiters.push(resolve))
      }
      this.invalidating = false
      return wasUnlocked
    })()
    this.invalidationPromise = pending.finally(() => {
      this.invalidationPromise = null
    })
    return this.invalidationPromise
  }

  leaseBoundKey(key: Buffer): VaultKeyLease {
    const binding = (key as BoundBuffer)[SESSION_KEY_BINDING]
    if (!binding || binding.owner !== this || binding.epoch !== this.epochValue || this.key !== key) {
      throw new VaultSessionChangedError()
    }
    if (this.invalidating) throw new VaultSessionChangedError()

    this.activeOperations += 1
    const leasedKey = Buffer.from(key)
    const epoch = binding.epoch
    let released = false
    return {
      key: leasedKey,
      epoch,
      assertCurrent: () => {
        if (released || this.invalidating || this.epochValue !== epoch || this.key !== key) {
          throw new VaultSessionChangedError()
        }
      },
      release: () => {
        if (released) return
        released = true
        leasedKey.fill(0)
        this.releaseOperation()
      },
    }
  }

  private releaseOperation(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1)
    if (this.activeOperations !== 0) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}

/**
 * Acquires a tracked copy for a live session key, or an isolated copy for raw
 * keys used during first-run setup/import and in focused tests.
 */
export function leaseVaultKey(key: Buffer): VaultKeyLease {
  const binding = (key as BoundBuffer)[SESSION_KEY_BINDING]
  if (binding) return binding.owner.leaseBoundKey(key)

  const leasedKey = Buffer.from(key)
  let released = false
  return {
    key: leasedKey,
    epoch: 0,
    assertCurrent: () => {
      if (released) throw new VaultSessionChangedError()
    },
    release: () => {
      if (released) return
      released = true
      leasedKey.fill(0)
    },
  }
}
