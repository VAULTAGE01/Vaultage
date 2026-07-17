import {
  contract,
  optionalNumber,
  requireRecord,
  requireString,
  type BaseIpcResult,
} from './ipcContracts'

export type MenuPanelSearchPayload = {
  query?: string
  limit?: number
}

export type MenuPanelCopyPayload = {
  secretId: string
  fieldId?: string
  fieldKey: string
  clearAfterMs?: number
  confirmationPhrase?: string
  pin?: string
}

export type MenuPanelRevealPayload = {
  secretId: string
  fieldId?: string
  fieldKey: string
  confirmationPhrase?: string
  pin?: string
}

export type MenuPanelCreatePayload =
  | {
      kind: 'text'
      name?: string
      value: string
    }
  | {
      kind: 'image'
      name?: string
      dataUrl: string
    }

export type MenuPanelAction =
  | 'lock'
  | 'startAgent'
  | 'stopAgent'
  | 'startBrowser'
  | 'stopBrowser'
  | 'copyAgentInstructions'
  | 'openPendingRequests'
  | 'settings'
  | 'quit'

export type MenuPanelActionPayload = {
  action: MenuPanelAction
}

export type MainWindowNavigationIntent = 'pending-requests' | 'settings'

export type MenuPanelStatusResult = BaseIpcResult & {
  appName?: string
  unlocked?: boolean
  pendingCount?: number
  agentListening?: boolean
  agentAvailable?: boolean
  agentPort?: number
  browserEnabled?: boolean
  browserAvailable?: boolean
  quickRevealPinEnabled?: boolean
  openCoreBuild?: boolean
}

export type MenuPanelSearchField = {
  id?: string
  key: string
  sensitive: boolean
  copyable: boolean
}

export type MenuPanelSearchResult = {
  id: string
  name: string
  type: string
  folderPath: string
  scope?: string
  tags: string[]
  lastUsedAt?: string
  usageCount?: number
  fields: MenuPanelSearchField[]
}

export type MenuPanelSearchResultPayload = BaseIpcResult & {
  locked?: boolean
  results?: MenuPanelSearchResult[]
}

export type MenuPanelCopyResult = BaseIpcResult & {
  revision?: number
  cancelled?: boolean
  notFound?: boolean
  authFailed?: boolean
}

export type MenuPanelRevealResult = MenuPanelCopyResult & {
  value?: string
}

export type MenuPanelCreateResult = BaseIpcResult & {
  revision?: number
  secretId?: string
  folderId?: string
}

export interface MenuPanelIpcApi {
  menuPanelStatus(): Promise<MenuPanelStatusResult>
  menuPanelSearch(payload?: MenuPanelSearchPayload): Promise<MenuPanelSearchResultPayload>
  menuPanelCopy(payload: MenuPanelCopyPayload): Promise<MenuPanelCopyResult>
  menuPanelReveal(payload: MenuPanelRevealPayload): Promise<MenuPanelRevealResult>
  menuPanelCreate(payload: MenuPanelCreatePayload): Promise<MenuPanelCreateResult>
  menuPanelAction(payload: MenuPanelActionPayload): Promise<BaseIpcResult>
  menuPanelOpenApp(): Promise<BaseIpcResult>
  menuPanelClose(): Promise<BaseIpcResult>
}

export const menuPanelIpcContracts = {
  status: contract<undefined, MenuPanelStatusResult>('menu-panel:status', validateNoPayload),
  search: contract<MenuPanelSearchPayload, MenuPanelSearchResultPayload>(
    'menu-panel:search',
    validateSearchPayload,
  ),
  copy: contract<MenuPanelCopyPayload, MenuPanelCopyResult>(
    'menu-panel:copy',
    validateCopyPayload,
  ),
  reveal: contract<MenuPanelRevealPayload, MenuPanelRevealResult>(
    'menu-panel:reveal',
    validateRevealPayload,
  ),
  create: contract<MenuPanelCreatePayload, MenuPanelCreateResult>(
    'menu-panel:create',
    validateCreatePayload,
  ),
  action: contract<MenuPanelActionPayload, BaseIpcResult>(
    'menu-panel:action',
    validateActionPayload,
  ),
  openApp: contract<undefined, BaseIpcResult>('menu-panel:open-app', validateNoPayload),
  close: contract<undefined, BaseIpcResult>('menu-panel:close', validateNoPayload),
} as const

export const menuPanelIpcEvents = {
  navigateMainWindow: 'menu-panel:navigate-main-window',
} as const

function validateNoPayload(payload: unknown): undefined {
  if (payload !== undefined) throw new Error('Unexpected IPC payload')
  return undefined
}

function validateSearchPayload(payload: unknown): MenuPanelSearchPayload {
  if (payload === undefined || payload === null) return {}
  const record = requireRecord(payload, 'menu panel search payload')
  const rawQuery = typeof record.query === 'string' ? record.query : undefined
  const rawLimit = optionalNumber(record.limit, 'result limit')
  return {
    query: rawQuery?.slice(0, 120),
    limit: rawLimit === undefined ? undefined : Math.max(1, Math.min(24, Math.floor(rawLimit))),
  }
}

function validateCopyPayload(payload: unknown): MenuPanelCopyPayload {
  const record = requireRecord(payload, 'menu panel copy payload')
  const clearAfterMs = optionalNumber(record.clearAfterMs, 'clipboard clear delay')
  return {
    secretId: requireString(record.secretId, 'secret id'),
    fieldId: optionalMenuPanelString(record.fieldId, 'field id'),
    fieldKey: requireString(record.fieldKey, 'field key'),
    clearAfterMs,
    confirmationPhrase: optionalMenuPanelString(record.confirmationPhrase, 'confirmation phrase'),
    pin: optionalMenuPanelString(record.pin, 'PIN'),
  }
}

function validateRevealPayload(payload: unknown): MenuPanelRevealPayload {
  const record = requireRecord(payload, 'menu panel reveal payload')
  return {
    secretId: requireString(record.secretId, 'secret id'),
    fieldId: optionalMenuPanelString(record.fieldId, 'field id'),
    fieldKey: requireString(record.fieldKey, 'field key'),
    confirmationPhrase: optionalMenuPanelString(record.confirmationPhrase, 'confirmation phrase'),
    pin: optionalMenuPanelString(record.pin, 'PIN'),
  }
}

function validateCreatePayload(payload: unknown): MenuPanelCreatePayload {
  const record = requireRecord(payload, 'menu panel create payload')
  const kind = requireString(record.kind, 'create kind')
  const name = optionalMenuPanelString(record.name, 'secret name')?.slice(0, 120)
  if (kind === 'text') {
    const value = requireString(record.value, 'secret text')
    if (!value.trim()) throw new Error('Secret text is required')
    return { kind, name, value: value.slice(0, 128 * 1024) }
  }
  if (kind === 'image') {
    const dataUrl = requireString(record.dataUrl, 'image data')
    if (!/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(dataUrl)) {
      throw new Error('Image data must be a supported data URL')
    }
    return { kind, name, dataUrl }
  }
  throw new Error('Invalid create kind')
}

function validateActionPayload(payload: unknown): MenuPanelActionPayload {
  const record = requireRecord(payload, 'menu panel action payload')
  const action = requireString(record.action, 'menu panel action')
  if (
    action !== 'lock' &&
    action !== 'startAgent' &&
    action !== 'stopAgent' &&
    action !== 'startBrowser' &&
    action !== 'stopBrowser' &&
    action !== 'copyAgentInstructions' &&
    action !== 'openPendingRequests' &&
    action !== 'settings' &&
    action !== 'quit'
  ) {
    throw new Error('Invalid menu panel action')
  }
  return { action }
}

function optionalMenuPanelString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireString(value, label)
}
