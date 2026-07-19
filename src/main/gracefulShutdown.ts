export class GracefulShutdownTimeoutError extends Error {
  readonly name = 'GracefulShutdownTimeoutError'

  constructor(readonly timeoutMs: number) {
    super(`Vault shutdown cleanup exceeded ${timeoutMs} ms`)
  }
}

export class UnexpectedGracefulShutdownError extends Error {
  readonly name = 'UnexpectedGracefulShutdownError'

  constructor(readonly value: unknown) {
    super('Vault shutdown cleanup failed with a non-Error value')
  }
}

export interface GracefulShutdownDependencies {
  readonly cleanup: () => Promise<void>
  readonly dispose: () => void
  readonly exit: () => void
  readonly reportFailure: (error: Error) => void
  readonly timeoutMs: number
}

function toShutdownError(error: unknown): Error {
  return error instanceof Error ? error : new UnexpectedGracefulShutdownError(error)
}

export async function runGracefulShutdown(
  dependencies: GracefulShutdownDependencies,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new GracefulShutdownTimeoutError(dependencies.timeoutMs))
    }, dependencies.timeoutMs)
    timeout.unref()
  })

  try {
    await Promise.race([dependencies.cleanup(), deadline])
  } catch (error) {
    dependencies.reportFailure(toShutdownError(error))
  } finally {
    if (timeout) clearTimeout(timeout)
    try {
      dependencies.dispose()
    } catch (error) {
      dependencies.reportFailure(toShutdownError(error))
    } finally {
      dependencies.exit()
    }
  }
}
