import {
  contract,
  requireRecord,
  requireString,
  validateNoPayload,
  type BaseIpcResult,
  type NoPayload,
} from './ipcContracts'

export type AppMode = 'local' | 'agent' | 'broker'
export type ModeSetPayload = { mode: string }

export interface ModeIpcApi {
  setMode(mode: string): Promise<BaseIpcResult>
  getMode(): Promise<string>
}

export const modeIpcContracts = {
  get: contract<NoPayload, string>('mode:get', validateNoPayload),
  set: contract<ModeSetPayload, BaseIpcResult>('mode:set', validateModeSetPayload),
} as const

export const modeIpcEvents = {
  changed: 'mode:changed',
} as const

function validateModeSetPayload(payload: unknown): ModeSetPayload {
  const record = requireRecord(payload, 'mode payload')
  return { mode: requireString(record.mode, 'mode') }
}
