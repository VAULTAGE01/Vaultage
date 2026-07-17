import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { shouldSkipUniversalSlice } = require('./apply-electron-fuses.cjs')

describe('Electron fuse universal-packaging phase policy', () => {
  it('skips only electron-builder temporary universal slices', () => {
    expect(shouldSkipUniversalSlice('/tmp/dist/mac-universal-x64-temp')).toBe(true)
    expect(shouldSkipUniversalSlice('/tmp/dist/mac-universal-arm64-temp')).toBe(true)
    expect(shouldSkipUniversalSlice('/tmp/dist/mac-universal')).toBe(false)
    expect(shouldSkipUniversalSlice('/tmp/dist/mac-arm64')).toBe(false)
  })
})
