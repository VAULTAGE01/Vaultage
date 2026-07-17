import type { AppMode } from './security'

export type MenuBarAction =
  | 'open'
  | 'unlock'
  | 'lock'
  | 'quickSearch'
  | 'startAgent'
  | 'stopAgent'
  | 'copyAgentInstructions'
  | 'openAgentDashboard'
  | 'settings'
  | 'quit'

export type MenuBarModelItem =
  | { type: 'separator'; id: string }
  | {
      type?: 'normal'
      id: string
      label: string
      enabled: boolean
      action?: MenuBarAction
    }

export interface MenuBarState {
  appName: string
  unlocked: boolean
  mode: AppMode
  agentApiEnabled: boolean
  pendingCount: number
  port: number
  openCoreBuild: boolean
}

export function buildMenuBarModel(state: MenuBarState): MenuBarModelItem[] {
  const items: MenuBarModelItem[] = [
    { id: 'status', label: menuBarStatusLabel(state), enabled: false },
    { id: 'after-status', type: 'separator' },
    { id: 'open', label: `Open ${state.appName}`, enabled: true, action: 'open' },
  ]

  if (state.unlocked) {
    items.push({ id: 'lock', label: `Lock ${state.appName}`, enabled: true, action: 'lock' })
  } else {
    items.push({ id: 'unlock', label: `Unlock ${state.appName}...`, enabled: true, action: 'unlock' })
  }

  items.push(
    { id: 'after-vault', type: 'separator' },
    { id: 'quick-search', label: 'Search & Copy Secrets...', enabled: state.unlocked, action: 'quickSearch' },
    { id: 'new-secret', label: 'New Secret', enabled: false },
    { id: 'new-from-clipboard', label: 'New from Clipboard', enabled: false },
  )

  if (!state.openCoreBuild) {
    items.push(
      { id: 'after-quick-actions', type: 'separator' },
      {
        id: 'pending-requests',
        label: state.pendingCount > 0
          ? `Pending Requests (${state.pendingCount})`
          : 'Pending Requests',
        enabled: state.pendingCount > 0,
        action: 'openAgentDashboard',
      },
      {
        id: 'agent-status',
        label: agentStatusLabel(state),
        enabled: false,
      },
    )

    if (isAgentListening(state)) {
      items.push({ id: 'stop-agent', label: 'Stop Agent Listening', enabled: true, action: 'stopAgent' })
    } else {
      items.push({
        id: 'start-agent',
        label: 'Start Agent Listening',
        enabled: state.unlocked,
        action: 'startAgent',
      })
    }

    items.push({
      id: 'copy-agent-instructions',
      label: 'Copy Agent Instructions',
      enabled: state.unlocked,
      action: 'copyAgentInstructions',
    })
  }

  items.push(
    { id: 'after-agent', type: 'separator' },
    { id: 'settings', label: 'Settings', enabled: true, action: 'settings' },
    { id: 'quit', label: `Quit ${state.appName}`, enabled: true, action: 'quit' },
  )

  return items
}

export function menuBarStatusLabel(state: MenuBarState): string {
  if (!state.unlocked) return `${state.appName}: Locked`
  if (state.pendingCount === 1) return `${state.appName}: 1 approval pending`
  if (state.pendingCount > 1) return `${state.appName}: ${state.pendingCount} approvals pending`
  if (isAgentListening(state)) return `${state.appName}: Agent listening on 127.0.0.1:${state.port}`
  if (state.mode === 'agent') return `${state.appName}: Agent off`
  return `${state.appName}: Unlocked`
}

export function menuBarTooltip(state: MenuBarState): string {
  return menuBarStatusLabel(state)
}

export function isAgentListening(state: MenuBarState): boolean {
  return state.mode === 'agent' && state.agentApiEnabled
}

function agentStatusLabel(state: MenuBarState): string {
  if (!state.unlocked) return 'Agent unavailable while locked'
  if (isAgentListening(state)) return `Agent listening on 127.0.0.1:${state.port}`
  return 'Agent not listening'
}
