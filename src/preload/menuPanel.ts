import { contextBridge, ipcRenderer } from 'electron'
import { menuPanelIpcContracts, type MenuPanelIpcApi } from '../shared/menuPanelIpcContracts'

const menuPanelIpc = menuPanelIpcContracts

const menuPanelApi: MenuPanelIpcApi = {
  menuPanelStatus: () => ipcRenderer.invoke(menuPanelIpc.status.channel),
  menuPanelSearch: (payload) => ipcRenderer.invoke(menuPanelIpc.search.channel, payload),
  menuPanelCopy: (payload) => ipcRenderer.invoke(menuPanelIpc.copy.channel, payload),
  menuPanelReveal: (payload) => ipcRenderer.invoke(menuPanelIpc.reveal.channel, payload),
  menuPanelCreate: (payload) => ipcRenderer.invoke(menuPanelIpc.create.channel, payload),
  menuPanelAction: (payload) => ipcRenderer.invoke(menuPanelIpc.action.channel, payload),
  menuPanelOpenApp: () => ipcRenderer.invoke(menuPanelIpc.openApp.channel),
  menuPanelClose: () => ipcRenderer.invoke(menuPanelIpc.close.channel),
}

// The menu panel intentionally receives no auth, full-vault, project,
// provider, Agent, audit, shell, or mode bridge. Every operation available to
// this secondary window is implemented and authorized by the dedicated
// menu-panel IPC controller.
contextBridge.exposeInMainWorld('vault', {
  platform: process.platform,
  ...menuPanelApi,
})
