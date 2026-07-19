import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const checker = resolve(import.meta.dirname, 'check-preload-surfaces.mjs')

const MENU_PANEL_CHANNELS = [
  'menu-panel:status',
  'menu-panel:search',
  'menu-panel:copy',
  'menu-panel:reveal',
  'menu-panel:create',
  'menu-panel:action',
  'menu-panel:open-app',
  'menu-panel:close',
]

const menuPanelSource = MENU_PANEL_CHANNELS.map(channel => `ipcRenderer.invoke('${channel}')`).join('\n')

function writeFixture(root, relativePath, source) {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
}

function runChecker(outputRoot, edition = 'open', withSeparator = false) {
  return spawnSync(process.execPath, [
    checker,
    ...(withSeparator ? ['--'] : []),
    '--edition',
    edition,
    '--output-root',
    outputRoot,
  ], { encoding: 'utf8' })
}

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-preload-surface-'))
  const outputRoot = join(root, 'preload')
  try {
    writeFixture(outputRoot, 'index.js', "contextBridge.exposeInMainWorld('vault', {})")
    writeFixture(outputRoot, 'menuPanel.js', menuPanelSource)
    return callback({ root, outputRoot })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('preload surface checker', () => {
  it('accepts an explicit standalone output root and edition', () => {
    withFixture(({ outputRoot }) => {
      const result = runChecker(outputRoot, 'private')
      expect(result.status, result.stderr).toBe(0)
    })
  })

  it('accepts the leading separator forwarded by the pnpm script', () => {
    withFixture(({ outputRoot }) => {
      const result = runChecker(outputRoot, 'open', true)
      expect(result.status, result.stderr).toBe(0)
    })
  })

  it('rejects a missing main preload entrypoint', () => {
    withFixture(({ outputRoot }) => {
      rmSync(join(outputRoot, 'index.js'))
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/index\.js|entrypoint/i)
    })
  })

  it('rejects an unexpected shared JavaScript chunk', () => {
    withFixture(({ outputRoot }) => {
      writeFixture(outputRoot, 'shared.js', 'export const shared = true')
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/unexpected|shared|extra/i)
    })
  })

  it('rejects an unexpected source map', () => {
    withFixture(({ outputRoot }) => {
      writeFixture(outputRoot, 'index.js.map', '{"version":3}')
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/unexpected|inventory|map/i)
    })
  })

  it('rejects unexpected JSON and asset files', () => {
    withFixture(({ outputRoot }) => {
      writeFixture(outputRoot, 'manifest.json', '{}')
      writeFixture(outputRoot, 'assets/preload.css', 'body {}')
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/unexpected|inventory|json|asset/i)
    })
  })

  it('rejects an unexpected native or binary artifact', () => {
    withFixture(({ outputRoot }) => {
      writeFixture(outputRoot, 'preload.node', Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/unexpected|inventory|native|binary|node/i)
    })
  })

  it('rejects a nested unexpected file', () => {
    withFixture(({ outputRoot }) => {
      writeFixture(outputRoot, 'nested/ignored.txt', 'unexpected')
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/unexpected|inventory|nested|file/i)
    })
  })

  it('rejects an otherwise empty output directory', () => {
    withFixture(({ outputRoot }) => {
      mkdirSync(join(outputRoot, 'empty'))
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/unexpected|inventory|empty|directory/i)
    })
  })

  it('rejects relative JavaScript require edges without following the target', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(join(outputRoot, 'menuPanel.js'), `${menuPanelSource}\nrequire('./shared.js')`)
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/relative|require/i)
    })
  })

  it('rejects relative JavaScript import edges', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(join(outputRoot, 'menuPanel.js'), `${menuPanelSource}\nimport './shared.js'`)
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/relative|import/i)
    })
  })

  it('rejects multiline static import edges', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(
        join(outputRoot, 'menuPanel.js'),
        `${menuPanelSource}\nimport {\n  missing,\n} from './shared.js'`,
      )
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/relative|import|shared/i)
    })
  })

  it('rejects computed and template dynamic imports even without a resolvable target', () => {
    for (const expression of ['import(target)', 'import(`./shared.js`)']) {
      withFixture(({ outputRoot }) => {
        writeFileSync(join(outputRoot, 'menuPanel.js'), `${menuPanelSource}\n${expression}`)
        const result = runChecker(outputRoot)
        expect(result.status, expression).not.toBe(0)
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/non-literal|dynamic|import/i)
      })
    }
  })

  it('rejects a computed non-Electron require even without a resolvable target', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(join(outputRoot, 'index.js'), "const target = 'node:fs'\nrequire(target)")
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/non-literal|require|external/i)
    })
  })

  it('rejects a symlinked output root before reading its entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'vaultage-preload-surface-symlink-'))
    try {
      const targetRoot = join(root, 'target', 'preload')
      const symlinkRoot = join(root, 'preload-link')
      writeFixture(targetRoot, 'index.js', "contextBridge.exposeInMainWorld('vault', {})")
      writeFixture(targetRoot, 'menuPanel.js', menuPanelSource)
      symlinkSync(targetRoot, symlinkRoot, 'dir')
      const result = runChecker(symlinkRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/symlink|symbolic|canonical|root/i)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects an output-root escape before following the dependency', () => {
    withFixture(({ root, outputRoot }) => {
      writeFixture(root, 'outside.js', 'module.exports = {}')
      writeFileSync(join(outputRoot, 'menuPanel.js'), `${menuPanelSource}\nrequire('../outside.js')`)
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/outside|escape|root/i)
    })
  })

  it('rejects every external dependency except Electron', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(join(outputRoot, 'index.js'), `${"require('electron')"}\nrequire('node:fs')`)
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/external|node:fs|electron/i)
    })
  })

  it('rejects private IPC channels from the menu-panel bridge', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(join(outputRoot, 'menuPanel.js'), `${menuPanelSource}\nipcRenderer.invoke('commercial:account:delete')`)
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/private|forbidden|commercial/i)
    })
  })

  it('rejects private IPC channels from an open-edition main preload', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(join(outputRoot, 'index.js'), "ipcRenderer.invoke('commercial:account:delete')")
      const result = runChecker(outputRoot, 'open')
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/private|forbidden|commercial/i)
    })
  })

  it('rejects a missing menu-panel capability channel', () => {
    withFixture(({ outputRoot }) => {
      writeFileSync(join(outputRoot, 'menuPanel.js'), menuPanelSource.replace("ipcRenderer.invoke('menu-panel:close')", ''))
      const result = runChecker(outputRoot)
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/required|menu-panel:close/i)
    })
  })
})
