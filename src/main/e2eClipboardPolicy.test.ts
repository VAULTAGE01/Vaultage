import { describe, expect, it, vi } from 'vitest'
import { installE2EClipboardPolicy } from './e2eClipboardPolicy'

function callable(target: object, key: PropertyKey): (...args: readonly unknown[]) => unknown {
  const value: unknown = Reflect.get(target, key)
  if (typeof value !== 'function') throw new TypeError(`Expected ${String(key)} to be callable`)
  return (...args: readonly unknown[]) => Reflect.apply(value, target, args)
}

function clipboardFixture(): {
  readonly target: Record<string, ReturnType<typeof vi.fn>>
  readonly originals: readonly ReturnType<typeof vi.fn>[]
} {
  const methodNames = [
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
  const originals = methodNames.map(() => vi.fn())
  const target: Record<string, ReturnType<typeof vi.fn>> = {}
  for (let index = 0; index < methodNames.length; index += 1) {
    const methodName = methodNames[index]
    const original = originals[index]
    if (methodName && original) target[methodName] = original
  }
  return { target, originals }
}

describe('Electron E2E clipboard policy', () => {
  it('uses only an in-memory text clipboard while headless policy is active', () => {
    // Given
    const fixture = clipboardFixture()
    const policy = installE2EClipboardPolicy(true, fixture.target)

    // When
    callable(fixture.target, 'writeText')('synthetic-local-value')
    const copied = callable(fixture.target, 'readText')()
    callable(fixture.target, 'clear')()

    // Then
    expect(copied).toBe('synthetic-local-value')
    expect(callable(fixture.target, 'readText')()).toBe('')
    expect(fixture.originals.every(original => original.mock.calls.length === 0)).toBe(true)
    expect(policy.kind).toBe('memory')
    expect(policy.snapshot()).toEqual({
      clears: 1,
      reads: 2,
      textLength: 0,
      writes: 1,
    })
    policy.dispose()
  })

  it('fails closed for image and raw-buffer operations without touching the system clipboard', () => {
    // Given
    const fixture = clipboardFixture()
    const policy = installE2EClipboardPolicy(true, fixture.target)

    // When / Then
    expect(() => callable(fixture.target, 'readImage')()).toThrowError('unavailable in headless E2E')
    expect(() => callable(fixture.target, 'writeBuffer')('format', Buffer.from('synthetic')))
      .toThrowError('unavailable in headless E2E')
    expect(fixture.originals.every(original => original.mock.calls.length === 0)).toBe(true)
    policy.dispose()
  })

  it('leaves the real clipboard path unchanged when policy is inactive', () => {
    // Given
    const fixture = clipboardFixture()

    // When
    const policy = installE2EClipboardPolicy(false, fixture.target)
    callable(fixture.target, 'writeText')('normal-application-value')

    // Then
    expect(policy.kind).toBe('system')
    expect(fixture.target.writeText).toHaveBeenCalledWith('normal-application-value')
    expect(policy.snapshot()).toBeNull()
  })
})
