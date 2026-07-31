export interface Ui2026Flags {
  readonly vault: boolean
  readonly projects: boolean
  readonly services: boolean
}

export type Ui2026Surface = keyof Ui2026Flags

export const UI2026_FLAG_NAMES: Readonly<Record<Ui2026Surface, string>> = {
  vault: 'ui2026.vault',
  projects: 'ui2026.projects',
  services: 'ui2026.services',
}

const DEFAULT_FLAGS: Ui2026Flags = Object.freeze({
  vault: false,
  projects: false,
  services: false,
})

function hasTrueFlag(value: object, key: Ui2026Surface): boolean {
  return key in value && Reflect.get(value, key) === true
}

export function parseUi2026Flags(value: unknown): Ui2026Flags {
  if (!value || typeof value !== 'object') return DEFAULT_FLAGS
  return Object.freeze({
    vault: hasTrueFlag(value, 'vault'),
    projects: hasTrueFlag(value, 'projects'),
    services: hasTrueFlag(value, 'services'),
  })
}

export const ui2026Flags = parseUi2026Flags(
  typeof __VAULTAGE_UI2026_FLAGS__ === 'undefined'
    ? undefined
    : __VAULTAGE_UI2026_FLAGS__,
)

export function isUi2026Enabled(
  surface: Ui2026Surface,
  flags: Ui2026Flags = ui2026Flags,
): boolean {
  return flags[surface]
}
