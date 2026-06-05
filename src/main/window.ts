import { app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { IS_MAC } from './keychain'
import { disableSecureInput } from './secureInput'

export function iconPath(): string {
  const file = IS_MAC ? 'icon.icns' : 'icon.ico'
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(app.getAppPath(), 'resources', file)
}

export function createMainWindow(onClosed: () => void): BrowserWindow {
  const icon = nativeImage.createFromPath(iconPath())
  const win = new BrowserWindow({
    width:    1200,
    height:   800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#00000000',
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon,
    webPreferences: {
      preload:          join(__dirname, '../preload/index.js'),
      sandbox:          true,
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  win.loadURL(
    process.env['ELECTRON_RENDERER_URL'] ??
    `file://${join(__dirname, '../renderer/index.html')}`,
  )
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [Level ${level}] [Line ${line} of ${sourceId}]: ${message}`)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  win.on('blur', () => {
    disableSecureInput()
  })
  win.on('closed', () => {
    disableSecureInput()
    onClosed()
  })

  return win
}
