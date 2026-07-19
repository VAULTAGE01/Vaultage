import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GracefulShutdownTimeoutError,
  runGracefulShutdown,
  type GracefulShutdownDependencies,
} from './gracefulShutdown'

describe('runGracefulShutdown', () => {
  afterEach(() => vi.useRealTimers())

  it('runs cleanup before disposing resources and exiting', async () => {
    const calls: string[] = []
    const dependencies = harness({
      cleanup: vi.fn(async () => { calls.push('cleanup') }),
      dispose: vi.fn(() => { calls.push('dispose') }),
      exit: vi.fn(() => { calls.push('exit') }),
    })

    await runGracefulShutdown(dependencies)

    expect(calls).toEqual(['cleanup', 'dispose', 'exit'])
    expect(dependencies.reportFailure).not.toHaveBeenCalled()
  })

  it('reports a bounded cleanup timeout, then disposes resources and exits', async () => {
    vi.useFakeTimers()
    const dependencies = harness({ cleanup: vi.fn(() => new Promise<void>(() => {})) })

    const shutdown = runGracefulShutdown(dependencies)
    await vi.advanceTimersByTimeAsync(5_000)
    await shutdown

    expect(dependencies.reportFailure).toHaveBeenCalledTimes(1)
    expect(dependencies.reportFailure).toHaveBeenCalledWith(
      expect.any(GracefulShutdownTimeoutError),
    )
    expect(dependencies.dispose).toHaveBeenCalledTimes(1)
    expect(dependencies.exit).toHaveBeenCalledTimes(1)
  })

  it('reports cleanup failures, then disposes resources and exits', async () => {
    const failure = new Error('synthetic cleanup failure')
    const dependencies = harness({ cleanup: vi.fn().mockRejectedValue(failure) })

    await runGracefulShutdown(dependencies)

    expect(dependencies.reportFailure).toHaveBeenCalledWith(failure)
    expect(dependencies.dispose).toHaveBeenCalledTimes(1)
    expect(dependencies.exit).toHaveBeenCalledTimes(1)
  })

  it('exits even when resource disposal fails', async () => {
    const failure = new Error('synthetic disposal failure')
    const dependencies = harness({ dispose: vi.fn(() => { throw failure }) })

    await runGracefulShutdown(dependencies)

    expect(dependencies.reportFailure).toHaveBeenCalledWith(failure)
    expect(dependencies.exit).toHaveBeenCalledTimes(1)
  })
})

function harness(
  overrides: Partial<GracefulShutdownDependencies> = {},
): GracefulShutdownDependencies {
  return {
    cleanup: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    exit: vi.fn(),
    reportFailure: vi.fn(),
    timeoutMs: 5_000,
    ...overrides,
  }
}
