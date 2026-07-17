import { describe, expect, it } from 'vitest'
import { buildMenuBarModel, menuBarStatusLabel, type MenuBarState } from './menuBarModel'

const baseState: MenuBarState = {
  appName: 'Vaultage',
  unlocked: false,
  mode: 'local',
  agentApiEnabled: false,
  pendingCount: 0,
  port: 43777,
  openCoreBuild: false,
}

describe('menu bar model', () => {
  it('shows a locked vault menu without enabling Agent listening', () => {
    const model = buildMenuBarModel(baseState)

    expect(menuBarStatusLabel(baseState)).toBe('Vaultage: Locked')
    expect(item(model, 'unlock')).toMatchObject({ label: 'Unlock Vaultage...', enabled: true })
    expect(item(model, 'quick-search')).toMatchObject({ label: 'Search & Copy Secrets...', enabled: false })
    expect(item(model, 'start-agent')).toMatchObject({ label: 'Start Agent Listening', enabled: false })
  })

  it('enables quick search when the vault is unlocked', () => {
    const model = buildMenuBarModel({ ...baseState, unlocked: true })

    expect(item(model, 'quick-search')).toMatchObject({
      label: 'Search & Copy Secrets...',
      enabled: true,
      action: 'quickSearch',
    })
  })

  it('shows Agent listening state and stop action when enabled', () => {
    const state: MenuBarState = {
      ...baseState,
      unlocked: true,
      mode: 'agent',
      agentApiEnabled: true,
    }
    const model = buildMenuBarModel(state)

    expect(menuBarStatusLabel(state)).toBe('Vaultage: Agent listening on 127.0.0.1:43777')
    expect(item(model, 'stop-agent')).toMatchObject({ label: 'Stop Agent Listening', enabled: true })
    expect(model.some(entry => entry.type !== 'separator' && entry.id === 'start-agent')).toBe(false)
  })

  it('prioritizes pending approval state over general listening status', () => {
    const state: MenuBarState = {
      ...baseState,
      unlocked: true,
      mode: 'agent',
      agentApiEnabled: true,
      pendingCount: 2,
    }

    expect(menuBarStatusLabel(state)).toBe('Vaultage: 2 approvals pending')
    expect(item(buildMenuBarModel(state), 'pending-requests')).toMatchObject({
      label: 'Pending Requests (2)',
      enabled: true,
    })
  })

  it('hides closed-source Agent actions in open-core builds', () => {
    const model = buildMenuBarModel({
      ...baseState,
      openCoreBuild: true,
      unlocked: true,
      mode: 'agent',
      agentApiEnabled: true,
      pendingCount: 1,
    })

    expect(model.some(entry => entry.type !== 'separator' && entry.id === 'pending-requests')).toBe(false)
    expect(model.some(entry => entry.type !== 'separator' && entry.id === 'stop-agent')).toBe(false)
    expect(item(model, 'lock')).toMatchObject({ enabled: true })
  })
})

function item(model: ReturnType<typeof buildMenuBarModel>, id: string) {
  const found = model.find(entry => entry.type !== 'separator' && entry.id === id)
  if (!found || found.type === 'separator') throw new Error(`Missing menu item ${id}`)
  return found
}
