import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createRequire } from 'module'
import {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire,
} from '@electron/fuses'

if (process.platform !== 'darwin') {
  console.log('Electron fuse policy check skipped on non-darwin platform.')
  process.exit(0)
}

const require = createRequire(import.meta.url)
const applyElectronFuses = require('./apply-electron-fuses.cjs')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'vaultage-electron-fuses-'))
const fixtureExecutable = join(fixtureRoot, 'Vaultage.app', 'Contents', 'MacOS', 'Vaultage')
const fixtureFramework = join(
  fixtureRoot,
  'Vaultage.app',
  'Contents',
  'Frameworks',
  'Electron Framework.framework',
  'Electron Framework',
)
mkdirSync(dirname(fixtureExecutable), { recursive: true })
mkdirSync(dirname(fixtureFramework), { recursive: true })
writeFileSync(fixtureExecutable, '#!/bin/sh\n')
writeFileSync(fixtureFramework, Buffer.concat([
  Buffer.alloc(64, 0),
  Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
  Buffer.from([1, 9]),
  Buffer.from('101100011'),
  Buffer.alloc(64, 0),
]))
chmodSync(fixtureExecutable, 0o755)

try {
  await applyElectronFuses({
    electronPlatformName: 'darwin',
    appOutDir: fixtureRoot,
    packager: { appInfo: { productFilename: 'Vaultage' } },
  })
  const wire = await getCurrentFuseWire(fixtureExecutable)
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.ENABLE],
    [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
  ])
  for (const [option, state] of expected) {
    if (wire[option] !== state) {
      throw new Error(`Electron fuse ${FuseV1Options[option]} has state ${wire[option]}, expected ${state}`)
    }
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log('Electron fuse policy check passed.')
