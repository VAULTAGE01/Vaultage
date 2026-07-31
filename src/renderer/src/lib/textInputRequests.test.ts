import { describe, expect, it, vi } from 'vitest'
import {
  createFolderFromInput,
  requestPlaintextExportConfirmation,
  requestSecretRevealConfirmation,
  textInputValueIsValid,
  type RequestTextInput,
} from './textInputRequests'

describe('text input requests', () => {
  it('creates a folder from a trimmed non-empty dialog value', async () => {
    const addFolder = vi.fn(async () => undefined)

    const created = await createFolderFromInput('folder-1', '  Deploy keys  ', addFolder)

    expect(created).toBe(true)
    expect(addFolder).toHaveBeenCalledOnce()
    expect(addFolder).toHaveBeenCalledWith('folder-1', 'Deploy keys')
  })

  it('does not mutate when folder creation is cancelled or blank', async () => {
    const addFolder = vi.fn(async () => undefined)

    expect(await createFolderFromInput('folder-1', null, addFolder)).toBe(false)
    expect(await createFolderFromInput('folder-1', '   ', addFolder)).toBe(false)
    expect(addFolder).not.toHaveBeenCalled()
  })

  it('requires the exact reveal phrase on platforms without native presence', async () => {
    const requestTextInput = vi.fn<RequestTextInput>(async options => {
      expect(options.validation).toEqual({ kind: 'exact', expected: 'REVEAL SECRET' })
      return 'REVEAL SECRET'
    })

    await expect(requestSecretRevealConfirmation('linux', requestTextInput))
      .resolves.toBe('REVEAL SECRET')
    expect(requestTextInput).toHaveBeenCalledOnce()
  })

  it('uses native presence on macOS without opening a text dialog', async () => {
    const requestTextInput = vi.fn<RequestTextInput>()

    await expect(requestSecretRevealConfirmation('darwin', requestTextInput))
      .resolves.toBeUndefined()
    expect(requestTextInput).not.toHaveBeenCalled()
  })

  it('keeps plaintext image export fail-closed on cancellation', async () => {
    const requestTextInput = vi.fn<RequestTextInput>(async () => null)

    await expect(requestPlaintextExportConfirmation({ platform: 'linux' }, requestTextInput))
      .resolves.toBeNull()
    expect(requestTextInput).toHaveBeenCalledWith(expect.objectContaining({
      validation: { kind: 'exact', expected: 'EXPORT PLAINTEXT' },
    }))
  })

  it('validates non-empty and exact-value dialog contracts', () => {
    expect(textInputValueIsValid('  name ', { kind: 'non-empty' })).toBe(true)
    expect(textInputValueIsValid('   ', { kind: 'non-empty' })).toBe(false)
    expect(textInputValueIsValid('REVEAL SECRET', { kind: 'exact', expected: 'REVEAL SECRET' })).toBe(true)
    expect(textInputValueIsValid('reveal secret', { kind: 'exact', expected: 'REVEAL SECRET' })).toBe(false)
  })
})
