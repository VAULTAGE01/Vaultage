import { isAbsolute } from 'path'

export const E2E_HEADLESS_INSPECTION_KEY = '__VAULTAGE_E2E_HEADLESS_INSPECTION__'

const E2E_CHILD_ENVIRONMENT_KEYS = [
  'CI',
  'HOME',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'PATH',
  'TMPDIR',
  'VAULTAGE_E2E_EVIDENCE_ID',
  'VAULTAGE_E2E_HEADLESS',
  'VAULTAGE_E2E_RUN_ID',
  'VAULTAGE_OPEN_CORE',
] as const

const VISIBILITY_ATTEMPTS = [
  'activate',
  'focus',
  'menuPanel',
  'openUrl',
  'restore',
  'secondInstance',
  'show',
  'showInactive',
] as const

type VisibilityAttempt = (typeof VISIBILITY_ATTEMPTS)[number]
type CreatedSurface = 'main' | 'menuPanel' | 'tray'

export type E2EChildEnvironment = {
  readonly CI: string
  readonly HOME: string
  readonly LANG: string
  readonly LC_ALL: string
  readonly NODE_ENV: string
  readonly PATH: string
  readonly TMPDIR: string
  readonly VAULTAGE_E2E_EVIDENCE_ID: string
  readonly VAULTAGE_E2E_HEADLESS: '1'
  readonly VAULTAGE_E2E_RUN_ID: string
  readonly VAULTAGE_OPEN_CORE: '1'
}

export type E2EChildEnvironmentInput = {
  readonly path: string
  readonly home: string
  readonly tmpDir: string
  readonly runId: string
  readonly evidenceId: string
  readonly lang: string
  readonly lcAll: string
  readonly ci: string
  readonly nodeEnv: string
}

export type E2EHeadlessSnapshot = {
  readonly active: true
  readonly attempts: Readonly<Record<VisibilityAttempt, number>>
  readonly created: {
    readonly mainWindows: number
    readonly menuPanels: number
    readonly trays: number
  }
  readonly showEvents: number
}

export interface E2EHeadlessPolicy {
  readonly active: boolean
  allow(action: VisibilityAttempt): boolean
  recordCreated(surface: CreatedSurface): void
  recordShowEvent(): void
  snapshot(): E2EHeadlessSnapshot | null
}

export type E2EWindow = {
  show(): void
  showInactive(): void
  focus(): void
  restore(): void
  hide(): void
  on(event: 'show', listener: () => void): unknown
}

export class E2EEnvironmentPolicyError extends Error {
  readonly name = 'E2EEnvironmentPolicyError'
}

export function useHiddenE2EWindow(isPackaged: boolean, flag: string | undefined): boolean {
  return !isPackaged && flag === '1'
}

export function createE2EHeadlessPolicy(
  isPackaged: boolean,
  flag: string | undefined,
): E2EHeadlessPolicy {
  const active = useHiddenE2EWindow(isPackaged, flag)
  const attempts: Record<VisibilityAttempt, number> = {
    activate: 0,
    focus: 0,
    menuPanel: 0,
    openUrl: 0,
    restore: 0,
    secondInstance: 0,
    show: 0,
    showInactive: 0,
  }
  const created = { mainWindows: 0, menuPanels: 0, trays: 0 }
  let showEvents = 0
  return {
    active,
    allow: action => {
      if (!active) return true
      attempts[action] += 1
      return false
    },
    recordCreated: surface => {
      if (!active) return
      if (surface === 'main') created.mainWindows += 1
      if (surface === 'menuPanel') created.menuPanels += 1
      if (surface === 'tray') created.trays += 1
    },
    recordShowEvent: () => {
      if (active) showEvents += 1
    },
    snapshot: () => active ? {
      active: true,
      attempts: { ...attempts },
      created: { ...created },
      showEvents,
    } : null,
  }
}

export function protectE2EWindow(
  window: E2EWindow,
  policy: E2EHeadlessPolicy,
  surface: 'main' | 'menuPanel',
): void {
  policy.recordCreated(surface)
  if (!policy.active) return
  Object.defineProperties(window, {
    show: { configurable: true, value: () => { policy.allow('show') } },
    showInactive: { configurable: true, value: () => { policy.allow('showInactive') } },
    focus: { configurable: true, value: () => { policy.allow('focus') } },
    restore: { configurable: true, value: () => { policy.allow('restore') } },
  })
  window.on('show', () => {
    policy.recordShowEvent()
    window.hide()
  })
}

export function installE2EHeadlessInspection(
  target: object,
  policy: E2EHeadlessPolicy,
  inspect: () => unknown,
): boolean {
  if (!policy.active) return false
  Object.defineProperty(target, E2E_HEADLESS_INSPECTION_KEY, {
    configurable: false,
    enumerable: false,
    value: inspect,
    writable: false,
  })
  return true
}

export function createE2EChildEnvironment(input: E2EChildEnvironmentInput): E2EChildEnvironment {
  const environment: E2EChildEnvironment = {
    CI: input.ci,
    HOME: input.home,
    LANG: input.lang,
    LC_ALL: input.lcAll,
    NODE_ENV: input.nodeEnv,
    PATH: input.path,
    TMPDIR: input.tmpDir,
    VAULTAGE_E2E_EVIDENCE_ID: input.evidenceId,
    VAULTAGE_E2E_HEADLESS: '1',
    VAULTAGE_E2E_RUN_ID: input.runId,
    VAULTAGE_OPEN_CORE: '1',
  }
  assertE2EChildEnvironment(environment)
  return Object.freeze(environment)
}

export function assertE2EChildEnvironment(environment: object): void {
  const allowed = new Set<string>(E2E_CHILD_ENVIRONMENT_KEYS)
  for (const key of Object.keys(environment)) {
    if (!allowed.has(key) || isForbiddenEnvironmentKey(key)) {
      throw new E2EEnvironmentPolicyError('forbidden child environment variable')
    }
    const value: unknown = Reflect.get(environment, key)
    if (typeof value !== 'string' || value.length === 0) {
      throw new E2EEnvironmentPolicyError('invalid child environment variable')
    }
  }
  if (Object.keys(environment).length !== E2E_CHILD_ENVIRONMENT_KEYS.length) {
    throw new E2EEnvironmentPolicyError('incomplete child environment allowlist')
  }
  if (Reflect.get(environment, 'VAULTAGE_E2E_HEADLESS') !== '1'
    || Reflect.get(environment, 'VAULTAGE_OPEN_CORE') !== '1') {
    throw new E2EEnvironmentPolicyError('inactive child environment policy')
  }
  if (!isAbsolute(String(Reflect.get(environment, 'HOME')))
    || !isAbsolute(String(Reflect.get(environment, 'TMPDIR')))) {
    throw new E2EEnvironmentPolicyError('synthetic child paths must be absolute')
  }
}

function isForbiddenEnvironmentKey(key: string): boolean {
  return key === 'ELECTRON_RENDERER_URL'
    || key === 'NODE_OPTIONS'
    || key === 'ELECTRON_RUN_AS_NODE'
    || /(?:^|_)(?:HTTP|HTTPS|ALL|NO)_PROXY$/i.test(key)
    || /(?:CREDENTIAL|TOKEN|PASSWORD|SECRET|PRIVATE_KEY)/i.test(key)
}
