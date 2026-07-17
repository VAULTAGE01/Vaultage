const { spawnSync } = require('child_process')
const { join } = require('path')
const { app } = require('electron')

const root = process.env.VAULTAGE_KEYCHAIN_SMOKE_ROOT
const copiedHelper = process.env.VAULTAGE_KEYCHAIN_SMOKE_COPY
if (!root || !copiedHelper) {
  console.error('VAULTAGE_KEYCHAIN_SMOKE_ROOT and VAULTAGE_KEYCHAIN_SMOKE_COPY are required')
  app.exit(1)
} else {
  app.whenReady().then(() => {
    const helper = join(root, 'resources', 'vault-keychain')
    const result = spawnSync(helper, ['verify-caller'], {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        VAULTAGE_KEYCHAIN_SERVICE: 'xyz.arcalab.vaultage.masterkey',
        VAULTAGE_KEYCHAIN_LEGACY_SERVICES: 'com.eden.vaultage.masterkey,com.eden.vaultage.masterkey.migration,dev.vault.app.masterkey',
        VAULTAGE_KEYCHAIN_MIGRATION_SERVICE: 'xyz.arcalab.vaultage.masterkey.migration',
        VAULTAGE_KEYCHAIN_DEV_ROOT: root,
      },
      timeout: 5_000,
    })
    if (result.status !== 0 || result.stdout.trim() !== 'vaultage-keychain-caller-v1') {
      console.error('authorized Electron caller was rejected', {
        status: result.status,
        signal: result.signal,
        stderr: result.stderr.trim(),
      })
      app.exit(1)
      return
    }
    const copiedResult = spawnSync(copiedHelper, ['verify-caller'], {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        VAULTAGE_KEYCHAIN_SERVICE: 'xyz.arcalab.vaultage.masterkey',
        VAULTAGE_KEYCHAIN_LEGACY_SERVICES: 'com.eden.vaultage.masterkey,com.eden.vaultage.masterkey.migration,dev.vault.app.masterkey',
        VAULTAGE_KEYCHAIN_MIGRATION_SERVICE: 'xyz.arcalab.vaultage.masterkey.migration',
        VAULTAGE_KEYCHAIN_DEV_ROOT: root,
      },
      timeout: 5_000,
    })
    if (copiedResult.status !== 5) {
      console.error('path-bound development helper copy was not rejected', {
        status: copiedResult.status,
        signal: copiedResult.signal,
        stderr: copiedResult.stderr.trim(),
      })
      app.exit(1)
      return
    }
    app.exit(0)
  }).catch((error) => {
    console.error(error)
    app.exit(1)
  })
}
