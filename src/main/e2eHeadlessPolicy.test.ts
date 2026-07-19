import { describe, expect, it, vi } from 'vitest'
import {
  E2E_HEADLESS_INSPECTION_KEY,
  assertE2EChildEnvironment,
  createE2EChildEnvironment,
  createE2EHeadlessPolicy,
  installE2EHeadlessInspection,
  protectE2EWindow,
  useHiddenE2EWindow,
} from './e2eHeadlessPolicy'

describe('hidden Electron E2E policy', () => {
  it('activates only for the explicit flag in an unpackaged application', () => {
    // Given / When / Then
    expect(useHiddenE2EWindow(false, '1')).toBe(true)
    expect(useHiddenE2EWindow(true, '1')).toBe(false)
    expect(useHiddenE2EWindow(false, undefined)).toBe(false)
    expect(useHiddenE2EWindow(false, '0')).toBe(false)
  })

  it('blocks window visibility attempts and records value-free counters when active', () => {
    // Given
    const policy = createE2EHeadlessPolicy(false, '1')
    const listeners = new Map<string, () => void>()
    const window = {
      show: vi.fn(),
      showInactive: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      hide: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener)
      }),
    }
    protectE2EWindow(window, policy, 'main')

    // When
    window.show()
    window.showInactive()
    window.focus()
    window.restore()
    listeners.get('show')?.()

    // Then
    expect(window.hide).toHaveBeenCalledOnce()
    expect(policy.snapshot()).toEqual({
      active: true,
      attempts: {
        activate: 0,
        focus: 1,
        menuPanel: 0,
        openUrl: 0,
        restore: 1,
        secondInstance: 0,
        show: 1,
        showInactive: 1,
      },
      created: { mainWindows: 1, menuPanels: 0, trays: 0 },
      showEvents: 1,
    })
  })

  it('leaves packaged window behavior untouched and exposes no inspection surface', () => {
    // Given
    const policy = createE2EHeadlessPolicy(true, '1')
    const target = {}
    const window = {
      show: vi.fn(),
      showInactive: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      hide: vi.fn(),
      on: vi.fn(),
    }

    // When
    protectE2EWindow(window, policy, 'main')
    const installed = installE2EHeadlessInspection(target, policy, () => ({ valueFree: true }))
    window.show()
    window.focus()

    // Then
    expect(installed).toBe(false)
    expect(Reflect.has(target, E2E_HEADLESS_INSPECTION_KEY)).toBe(false)
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(policy.snapshot()).toBeNull()
  })

  it('constructs an exact synthetic child environment and rejects forbidden additions', () => {
    // Given
    const environment = createE2EChildEnvironment({
      path: '/usr/bin:/bin',
      home: '/tmp/vaultage-policy-run/home',
      tmpDir: '/tmp/vaultage-policy-run/tmp',
      runId: 'policy-run',
      evidenceId: 'task-6',
      lang: 'en_US.UTF-8',
      lcAll: 'en_US.UTF-8',
      ci: '1',
      nodeEnv: 'test',
    })

    // When / Then
    expect(Object.keys(environment).sort()).toEqual([
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
    ])
    expect(() => assertE2EChildEnvironment(environment)).not.toThrow()
    expect(() => assertE2EChildEnvironment({
      ...environment,
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173',
    })).toThrowError('forbidden child environment variable')
    expect(() => assertE2EChildEnvironment({
      ...environment,
      HTTPS_PROXY: 'http://127.0.0.1:8080',
    })).toThrowError('forbidden child environment variable')
    expect(() => assertE2EChildEnvironment({
      ...environment,
      PROVIDER_TOKEN: 'synthetic-but-forbidden',
    })).toThrowError('forbidden child environment variable')
  })
})
