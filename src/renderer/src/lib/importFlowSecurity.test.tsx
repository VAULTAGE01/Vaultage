import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ImportPreviewValue, IMPORT_VALUE_MASK } from '../components/ImportPreviewValue'
import type { PreparedSecret } from './csvImport'
import {
  ImportParseAttemptGate,
  MAX_IMAGE_IMPORT_AGGREGATE_DECODED_BYTES,
  MAX_IMAGE_IMPORT_SELECTION_COUNT,
  isCurrentImportDestination,
  readBoundedImageImportSelection,
  runGuardedImportAttempt,
} from './importFlowSecurity'
import type { VaultRoot } from '../types'

function preparedSecret(value: string): PreparedSecret {
  return {
    index: 0,
    raw: { name: 'Production token', type: 'apiKey', value },
    secret: {
      name: 'Production token',
      type: 'apiKey',
      fields: [{ key: 'API Key', value, sensitive: true }],
      notes: '',
    },
    error: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function vaultWithDestination(): VaultRoot {
  return {
    version: 1,
    revision: 4,
    root: {
      id: 'root',
      name: 'Vault',
      secrets: [],
      children: [{ id: 'destination', name: 'Import here', secrets: [], children: [] }],
    },
    providers: [],
    envProjects: [],
  }
}

describe('import-flow security', () => {
  it('never places a plaintext secret value in preview markup or attributes', () => {
    const plaintext = 'sk_live_never-render-this'
    const html = renderToStaticMarkup(<ImportPreviewValue item={preparedSecret(plaintext)} />)

    expect(html).toContain(IMPORT_VALUE_MASK)
    expect(html).toContain('Secret value hidden')
    expect(html).not.toContain(plaintext)
    expect(html).not.toContain('title=')
  })

  it('discards a completed decrypt result after its input is superseded', async () => {
    const gate = new ImportParseAttemptGate()
    const fingerprintAttempt = gate.begin('encrypted-export-one')
    expect(gate.isCurrent(fingerprintAttempt, 'encrypted-export-one-tampered')).toBe(false)

    const decrypt = deferred<{ plaintext: string }>()
    let currentInput = 'encrypted-export-one'
    let committedPlaintext: string | null = null
    const pending = runGuardedImportAttempt(
      gate,
      currentInput,
      () => currentInput,
      () => decrypt.promise,
    )

    currentInput = 'encrypted-export-two'
    gate.invalidate()
    decrypt.resolve({ plaintext: 'must-not-commit' })
    const outcome = await pending
    if (outcome.status === 'current') committedPlaintext = outcome.value.plaintext

    expect(outcome.status).toBe('stale')
    expect(committedPlaintext).toBeNull()
  })

  it('rejects a destination removed from the current vault snapshot', () => {
    const initial = vaultWithDestination()
    expect(isCurrentImportDestination(initial, 'destination')).toBe(true)

    const current: VaultRoot = {
      ...initial,
      revision: 5,
      root: { ...initial.root, children: [] },
    }
    expect(isCurrentImportDestination(current, 'destination')).toBe(false)
    expect(isCurrentImportDestination(current, 'root')).toBe(true)
  })

  it('rejects aggregate decoded bytes and excessive selections before reading files', async () => {
    const reader = vi.fn(async () => 'data:image/png;base64,AA==')
    const halfPlusOne = Math.floor(MAX_IMAGE_IMPORT_AGGREGATE_DECODED_BYTES / 2) + 1
    const aggregate = await readBoundedImageImportSelection([
      { name: 'one.png', type: 'image/png', size: halfPlusOne, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) },
      { name: 'two.png', type: 'image/png', size: halfPlusOne, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) },
    ], reader)

    expect(aggregate).toMatchObject({ ok: false })
    expect(reader).not.toHaveBeenCalled()

    const excessive = await readBoundedImageImportSelection(
      Array.from({ length: MAX_IMAGE_IMPORT_SELECTION_COUNT + 1 }, (_, index) => ({
        name: `${index}.png`,
        type: 'image/png',
        size: 1,
        slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      })),
      reader,
    )
    expect(excessive).toMatchObject({ ok: false })
    expect(reader).not.toHaveBeenCalled()
  })

  it('rejects unsupported and signature-spoofed image imports', async () => {
    const reader = vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=')
    const svg = Uint8Array.from([0x3c, 0x73, 0x76, 0x67])
    const unsupported = await readBoundedImageImportSelection([{
      name: 'vector.svg',
      type: 'image/svg+xml',
      size: svg.byteLength,
      slice: (start = 0, end = svg.byteLength) => ({ arrayBuffer: async () => svg.slice(start, end).buffer }),
    }], reader)
    expect(unsupported).toMatchObject({ ok: false })
    expect(reader).not.toHaveBeenCalled()

    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    const spoofed = await readBoundedImageImportSelection([{
      name: 'spoofed.png',
      type: 'image/png',
      size: gif.byteLength,
      slice: (start = 0, end = gif.byteLength) => ({ arrayBuffer: async () => gif.slice(start, end).buffer }),
    }], reader)
    expect(spoofed).toMatchObject({ ok: true })
    if (spoofed.ok) {
      expect(spoofed.items[0]?.dataUrl).toBeNull()
      expect(spoofed.items[0]?.error).toBeInstanceOf(Error)
    }
    expect(reader).not.toHaveBeenCalled()
  })
})
