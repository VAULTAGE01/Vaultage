import { app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { IS_MAC } from './keychain'
import { disableSecureInput } from './secureInput'
import { protectE2EWindow, type E2EHeadlessPolicy } from './e2eHeadlessPolicy'
import { MAIN_WINDOW_GEOMETRY } from './windowGeometry'

export const MENU_PANEL_PARTITION = 'vaultage-menu-panel'

export function iconPath(): string {
  const file = IS_MAC ? 'icon.icns' : 'icon.ico'
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(app.getAppPath(), 'resources', file)
}

export function createMainWindow(
  onClosed: () => void,
  e2eHeadlessPolicy: E2EHeadlessPolicy,
): BrowserWindow {
  const icon = nativeImage.createFromPath(iconPath())
  const win = new BrowserWindow({
    ...MAIN_WINDOW_GEOMETRY,
    show:     !e2eHeadlessPolicy.active,
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
  protectE2EWindow(win, e2eHeadlessPolicy, 'main')

  win.loadURL(
    process.env['ELECTRON_RENDERER_URL'] ??
    `file://${join(__dirname, '../renderer/index.html')}`,
  )
  if (!app.isPackaged) {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[Renderer Console] [Level ${level}] [Line ${line} of ${sourceId}]: ${message}`)
    })
  }
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

export function createMenuPanelWindow(
  onClosed: () => void,
  e2eHeadlessPolicy: E2EHeadlessPolicy,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 640,
    minWidth: 340,
    minHeight: 520,
    maxWidth: 460,
    maxHeight: 760,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111111',
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload:          join(__dirname, '../preload/menuPanel.js'),
      partition:        MENU_PANEL_PARTITION,
      sandbox:          true,
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })
  protectE2EWindow(win, e2eHeadlessPolicy, 'menuPanel')

  win.loadURL(rendererUrl('menu-bar'))
  // The panel is a plaintext-capable secondary surface. Keep it protected for
  // its full lifetime so a reveal cannot race a window-level protection toggle.
  win.setContentProtection(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  win.on('blur', () => {
    disableSecureInput()
    win.hide()
  })
  win.on('closed', () => {
    disableSecureInput()
    onClosed()
  })

  return win
}

function rendererUrl(surface?: string): string {
  const base = process.env['ELECTRON_RENDERER_URL'] ??
    `file://${join(__dirname, '../renderer/index.html')}`
  if (!surface) return base
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}surface=${encodeURIComponent(surface)}`
}
