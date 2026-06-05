export const DEFAULT_IDLE_LOCK_SECONDS = 15 * 60
export const DEFAULT_IDLE_CHECK_MS = 30 * 1000

export interface IdleAutoLockDeps {
  isUnlocked: () => boolean
  getSystemIdleSeconds: () => number
  lock: (reason: string) => void
  idleSeconds?: number
  checkIntervalMs?: number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export class IdleAutoLockController {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly idleSeconds: number
  private readonly checkIntervalMs: number
  private readonly setIntervalFn: typeof setInterval
  private readonly clearIntervalFn: typeof clearInterval

  constructor(private readonly deps: IdleAutoLockDeps) {
    this.idleSeconds = deps.idleSeconds ?? DEFAULT_IDLE_LOCK_SECONDS
    this.checkIntervalMs = deps.checkIntervalMs ?? DEFAULT_IDLE_CHECK_MS
    this.setIntervalFn = deps.setIntervalFn ?? setInterval
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  }

  start(): void {
    if (this.timer) return
    this.timer = this.setIntervalFn(() => this.check(), this.checkIntervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    this.clearIntervalFn(this.timer)
    this.timer = null
  }

  check(): void {
    if (!this.deps.isUnlocked()) return
    if (this.deps.getSystemIdleSeconds() < this.idleSeconds) return
    this.deps.lock('idle-timeout')
  }
}
