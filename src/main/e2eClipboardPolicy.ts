const CLIPBOARD_METHODS = [
  'availableFormats',
  'clear',
  'has',
  'read',
  'readBookmark',
  'readBuffer',
  'readFindText',
  'readHTML',
  'readImage',
  'readRTF',
  'readText',
  'write',
  'writeBookmark',
  'writeBuffer',
  'writeFindText',
  'writeHTML',
  'writeImage',
  'writeRTF',
  'writeText',
] as const

export type E2EClipboardSnapshot = {
  readonly clears: number
  readonly reads: number
  readonly textLength: number
  readonly writes: number
}

export type E2EClipboardPolicy = {
  readonly kind: 'memory' | 'system'
  snapshot(): E2EClipboardSnapshot | null
  dispose(): void
}

export class E2EClipboardPolicyError extends Error {
  readonly name = 'E2EClipboardPolicyError'
}

export function installE2EClipboardPolicy(
  active: boolean,
  target: object,
): E2EClipboardPolicy {
  if (!active) {
    return {
      kind: 'system',
      snapshot: () => null,
      dispose: () => undefined,
    }
  }

  const restorers: Array<() => void> = []
  let text = ''
  let reads = 0
  let writes = 0
  let clears = 0
  const unavailable = (): never => {
    throw new E2EClipboardPolicyError('clipboard surface is unavailable in headless E2E')
  }
  const readText = (): string => {
    reads += 1
    return text
  }
  const writeText = (value: unknown): void => {
    if (typeof value !== 'string') {
      throw new E2EClipboardPolicyError('clipboard text must be a string')
    }
    writes += 1
    text = value
  }
  const clear = (): void => {
    clears += 1
    text = ''
  }

  for (const method of CLIPBOARD_METHODS) {
    replaceClipboardFunction(target, method, unavailable, restorers)
  }
  replaceClipboardFunction(target, 'availableFormats', () => text ? ['text/plain'] : [], restorers)
  replaceClipboardFunction(target, 'clear', clear, restorers)
  replaceClipboardFunction(target, 'has', (format: unknown) => format === 'text/plain' && text.length > 0, restorers)
  replaceClipboardFunction(target, 'read', (format: unknown) => format === 'text/plain' ? readText() : '', restorers)
  replaceClipboardFunction(target, 'readFindText', readText, restorers)
  replaceClipboardFunction(target, 'readText', readText, restorers)
  replaceClipboardFunction(target, 'writeFindText', writeText, restorers)
  replaceClipboardFunction(target, 'writeText', writeText, restorers)

  return {
    kind: 'memory',
    snapshot: () => ({ clears, reads, textLength: text.length, writes }),
    dispose: () => {
      text = ''
      for (let index = restorers.length - 1; index >= 0; index -= 1) {
        restorers[index]?.()
      }
    },
  }
}

function replaceClipboardFunction(
  target: object,
  key: PropertyKey,
  replacement: (...args: readonly unknown[]) => unknown,
  restorers: Array<() => void>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new E2EClipboardPolicyError(`required clipboard surface is unavailable: ${String(key)}`)
  }
  Object.defineProperty(target, key, { ...descriptor, value: replacement })
  restorers.push(() => {
    Object.defineProperty(target, key, descriptor)
  })
}
