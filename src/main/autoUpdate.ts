import { app, dialog } from 'electron'

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let installed = false
let promptOpen = false

export function installAutoUpdateChecks(): void {
  if (installed) return
  installed = true

  if (!app.isPackaged || process.env.VAULTAGE_DISABLE_AUTO_UPDATE === '1') return

  void import('electron-updater')
    .then(({ autoUpdater }) => configureAutoUpdater(autoUpdater))
    .catch((err) => {
      console.warn('[updater] unavailable:', err instanceof Error ? err.message : err)
    })
}

function configureAutoUpdater(autoUpdater: typeof import('electron-updater').autoUpdater): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('error', (err) => {
    console.warn('[updater] update check failed:', err instanceof Error ? err.message : err)
  })

  autoUpdater.on('update-available', async (info) => {
    if (promptOpen) return
    promptOpen = true
    try {
      const result = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: `Vaultage ${info.version} is available`,
        detail: 'Download the signed update from the official release channel.',
      })
      if (result.response === 0) {
        await autoUpdater.downloadUpdate()
      }
    } catch (err) {
      console.warn('[updater] download failed:', err instanceof Error ? err.message : err)
    } finally {
      promptOpen = false
    }
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (promptOpen) return
    promptOpen = true
    try {
      const result = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: `Vaultage ${info.version} is ready to install`,
        detail: 'Restart Vaultage to apply the signed update.',
      })
      if (result.response === 0) autoUpdater.quitAndInstall()
    } finally {
      promptOpen = false
    }
  })

  const check = () => {
    void autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] check failed:', err instanceof Error ? err.message : err)
    })
  }

  setTimeout(check, 30_000)
  setInterval(check, UPDATE_CHECK_INTERVAL_MS)
}
