import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  click,
  installRendererDom,
  StubElement,
  type StubNode,
  type StubRendererWindow,
} from '../test/fakeRendererDom'

const vaultContext = vi.hoisted(() => ({
  value: null as unknown,
}))
const setupAccount = vi.hoisted(() => ({
  value: null as unknown,
}))

vi.mock('../vaultContext', () => ({
  useVault: () => vaultContext.value,
}))
vi.mock('./AuthBackdrop', () => ({
  default: () => createElement('div', { 'aria-hidden': 'true' }),
}))
vi.mock('#commercial-setup-account', () => ({
  useCommercialSetupAccount: () => setupAccount.value,
}))

import SetupScreen from './SetupScreen'

let rootElement: StubElement
let root: Root | undefined
let rendererWindow: StubRendererWindow
let keydownListener: ((event: KeyboardEvent) => void) | undefined

beforeAll(() => {
  const installed = installRendererDom()
  rendererWindow = installed.window
  rootElement = installed.root
})

beforeEach(() => {
  keydownListener = undefined
  Object.assign(rendererWindow, {
    addEventListener: vi.fn((type: string, listener: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') keydownListener = listener
    }),
    removeEventListener: vi.fn(),
  })
  vaultContext.value = {
    setup: vi.fn(async () => undefined),
    restoreBackupWithKit: vi.fn(async () => ({ success: true })),
    state: { error: null },
  }
  setupAccount.value = {
    accountStatus: 'signed-out',
    available: true,
    loading: false,
    operation: null,
    error: null,
    clearError: vi.fn(),
    createAccount: vi.fn(async () => undefined),
    signIn: vi.fn(async () => undefined),
    cancelAuthentication: vi.fn(async () => undefined),
  }
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  rootElement.childNodes.splice(0)
})

describe('SetupScreen', () => {
  it('keeps the edition welcome copy and existing local-vault selector', async () => {
    await renderSetup()

    const localVaultAction = requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'create-local',
    ))

    if (__VAULTAGE_OPEN_CORE__) {
      expect(rootElement.textContent).toContain('Create your local vault')
      expect(localVaultAction.getAttribute('data-ui26-tone')).toBe('primary')
      expect(rootElement.textContent).toContain('Local-first Community')
      expect(rootElement.textContent).not.toContain('30-day, no-card Pro trial')
    } else {
      const createAccountAction = requireElement(findByAttribute(
        rootElement,
        'data-onboarding-action',
        'create-account',
      ))
      const signInAction = requireElement(findByAttribute(
        rootElement,
        'data-onboarding-action',
        'sign-in',
      ))
      expect(rootElement.textContent).toContain('Start with your Vaultage account')
      expect(createAccountAction.getAttribute('data-ui26-tone')).toBe('primary')
      expect(signInAction.getAttribute('data-ui26-tone')).toBe('secondary')
      expect(localVaultAction.getAttribute('data-ui26-tone')).toBe('secondary')
      expect(rootElement.textContent).toContain('Use Vaultage locally')
      expect(rootElement.textContent).toContain('30-day, no-card Pro trial')
    }
  })

  it('authenticates a closed-edition account before continuing to local encryption', async () => {
    const onSetupDestination = vi.fn()
    await renderSetup(onSetupDestination)

    const accountAction = findByAttribute(
      rootElement,
      'data-onboarding-action',
      'create-account',
    )

    if (__VAULTAGE_OPEN_CORE__) {
      expect(accountAction).toBeNull()
      return
    }

    expect(accountAction).not.toBeNull()
    expect(accountAction?.textContent).toContain('Create Vaultage account')
    await act(async () => click(rootElement, requireElement(accountAction)))

    expect((setupAccount.value as { createAccount: ReturnType<typeof vi.fn> }).createAccount)
      .toHaveBeenCalledOnce()
    expect(onSetupDestination).toHaveBeenCalledWith('account')
    expect(findByAttribute(rootElement, 'data-onboarding-step', 'password')).not.toBeNull()
    expect(findByAttribute(rootElement, 'data-onboarding-next', 'account')).not.toBeNull()
  })

  it('keeps existing-account sign-in distinct from account creation', async () => {
    if (__VAULTAGE_OPEN_CORE__) return
    const onSetupDestination = vi.fn()
    await renderSetup(onSetupDestination)

    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'sign-in',
    ))))

    expect((setupAccount.value as { signIn: ReturnType<typeof vi.fn> }).signIn)
      .toHaveBeenCalledOnce()
    expect((setupAccount.value as { createAccount: ReturnType<typeof vi.fn> }).createAccount)
      .not.toHaveBeenCalled()
    expect(onSetupDestination).toHaveBeenCalledWith('account')
    expect(findByAttribute(rootElement, 'data-onboarding-step', 'password')).not.toBeNull()
  })

  it('keeps local setup available when online account access is unavailable', async () => {
    if (__VAULTAGE_OPEN_CORE__) return
    setupAccount.value = {
      ...(setupAccount.value as object),
      available: false,
    }
    await renderSetup()

    expect(findByAttribute(rootElement, 'data-onboarding-action', 'create-account')
      ?.getAttribute('disabled')).not.toBeNull()
    expect(findByAttribute(rootElement, 'data-onboarding-action', 'sign-in')
      ?.getAttribute('disabled')).not.toBeNull()
    expect(findByAttribute(rootElement, 'data-onboarding-action', 'create-local')
      ?.getAttribute('disabled')).toBeNull()
    expect(rootElement.textContent).toContain('Local Vault and Projects remain available')
  })

  it('lets a previously authenticated account continue without reopening sign-in', async () => {
    if (__VAULTAGE_OPEN_CORE__) return
    setupAccount.value = {
      ...(setupAccount.value as object),
      accountStatus: 'signed-in',
    }
    const onSetupDestination = vi.fn()
    await renderSetup(onSetupDestination)

    expect(findByAttribute(rootElement, 'data-onboarding-action', 'create-account')).toBeNull()
    expect(findByAttribute(rootElement, 'data-onboarding-action', 'sign-in')).toBeNull()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'continue-account',
    ))))

    expect((setupAccount.value as { signIn: ReturnType<typeof vi.fn> }).signIn)
      .not.toHaveBeenCalled()
    expect(onSetupDestination).toHaveBeenCalledWith('account')
    expect(findByAttribute(rootElement, 'data-onboarding-step', 'password')).not.toBeNull()
  })

  it('replaces an account-directed choice when the user returns to local setup', async () => {
    if (__VAULTAGE_OPEN_CORE__) return
    const onSetupDestination = vi.fn()
    await renderSetup(onSetupDestination)

    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'create-account',
    ))))
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'back',
    ))))
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'create-local',
    ))))

    expect(onSetupDestination.mock.calls).toEqual([
      ['account'],
      ['vault'],
    ])
    expect(findByAttribute(rootElement, 'data-onboarding-next', 'vault')).not.toBeNull()
  })

  it('places the security explanation before password entry and preserves back navigation', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'create-local',
    ))))

    const section = requireElement(findByAttribute(rootElement, 'aria-labelledby', 'setup-security-model-title'))
    const passwordInput = requireElement(findByAttribute(rootElement, 'id', 'setup-master-password'))
    const orderedElements = flattenElements(rootElement)

    expect(orderedElements.indexOf(section)).toBeLessThan(orderedElements.indexOf(passwordInput))
    expect(passwordInput.getAttribute('data-secure-input')).toBe('true')
    expect(findByAttribute(rootElement, 'id', 'setup-confirm-password')?.getAttribute('data-secure-input')).toBe('true')
    expect(rootElement.textContent).toContain('Vaultage cannot reset this password')

    await act(async () => keydownListener?.(Object.assign(new Event('keydown'), { key: 'Escape' }) as KeyboardEvent))
    expect(findByAttribute(rootElement, 'data-onboarding-step', 'welcome')).not.toBeNull()
  })

  it('keeps vault creation disabled until both password fields are valid and matching', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'create-local',
    ))))

    const createButton = requireElement(findByAttribute(rootElement, 'data-onboarding-action', 'create-vault'))
    expect(createButton.getAttribute('disabled')).not.toBeNull()

    await act(async () => {
      changeInput(requireElement(findByAttribute(rootElement, 'id', 'setup-master-password')), 'correct horse battery staple')
      changeInput(requireElement(findByAttribute(rootElement, 'id', 'setup-confirm-password')), 'correct horse battery staple')
    })

    expect(createButton.getAttribute('disabled')).toBeNull()
    await act(async () => click(rootElement, createButton))
    expect((vaultContext.value as { setup: ReturnType<typeof vi.fn> }).setup).toHaveBeenCalledOnce()
    expect((vaultContext.value as { setup: ReturnType<typeof vi.fn> }).setup).toHaveBeenCalledWith('correct horse battery staple')
  })

  it('separates invalid field state, password strength, and the primary create action', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'create-local',
    ))))

    const passwordInput = requireElement(findByAttribute(rootElement, 'id', 'setup-master-password'))
    const confirmationInput = requireElement(findByAttribute(rootElement, 'id', 'setup-confirm-password'))
    const createButton = requireElement(findByAttribute(rootElement, 'data-onboarding-action', 'create-vault'))
    const strongPassword = 'Correct Horse Battery Staple! 2026'

    await act(async () => changeInput(passwordInput, 'too short'))

    expect(passwordInput.getAttribute('aria-invalid')).toBe('true')
    expect(passwordInput.getAttribute('aria-describedby')).toContain('setup-password-policy-error')
    expect(createButton.getAttribute('disabled')).not.toBeNull()

    await act(async () => {
      changeInput(passwordInput, strongPassword)
      changeInput(confirmationInput, 'different correct phrase')
    })

    expect(confirmationInput.getAttribute('aria-invalid')).toBe('true')
    expect(confirmationInput.getAttribute('aria-describedby')).toBe('setup-password-mismatch-error')
    expect(createButton.getAttribute('disabled')).not.toBeNull()

    await act(async () => changeInput(confirmationInput, strongPassword))

    const strengthMeter = requireElement(findByAttribute(rootElement, 'data-ui26-strength-tone', 'success'))
    expect(strengthMeter.tagName.toLowerCase()).toBe('progress')
    expect(createButton.getAttribute('data-ui26-tone')).toBe('primary')
    expect(createButton.getAttribute('disabled')).toBeNull()
  })

  it('offers clean-machine recovery from the first screen', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'restore',
    ))))

    expect(findByAttribute(rootElement, 'data-onboarding-step', 'restore')).not.toBeNull()
    expect(findByAttribute(rootElement, 'id', 'restore-kit-code')?.getAttribute('data-secure-input')).toBe('true')
    expect(rootElement.textContent).toContain('exact vault binding')
    expect(findByAttribute(rootElement, 'data-onboarding-action', 'choose-backup')?.getAttribute('disabled')).not.toBeNull()
  })

  it('submits valid clean-machine recovery through the bounded restore payload', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'restore',
    ))))

    const recoveryCode = 'VLT1-SYNTHETIC-RESTORE-CODE'
    const newPassword = 'Correct Horse Battery Staple! 2026'
    const restoreBackupWithKit = (vaultContext.value as {
      restoreBackupWithKit: ReturnType<typeof vi.fn>
    }).restoreBackupWithKit

    await act(async () => {
      changeInput(requireElement(findByAttribute(rootElement, 'id', 'restore-kit-code')), recoveryCode)
      changeInput(requireElement(findByAttribute(rootElement, 'id', 'restore-new-password')), newPassword)
      changeInput(requireElement(findByAttribute(rootElement, 'id', 'restore-confirm-password')), newPassword)
      changeInput(requireElement(findByAttribute(rootElement, 'id', 'restore-confirmation')), 'RESTORE VAULT')
    })

    const restoreButton = requireElement(findByAttribute(rootElement, 'data-onboarding-action', 'choose-backup'))
    expect(restoreButton.getAttribute('disabled')).toBeNull()

    await act(async () => click(rootElement, restoreButton))

    expect(restoreBackupWithKit).toHaveBeenCalledOnce()
    expect(restoreBackupWithKit).toHaveBeenCalledWith({
      recoveryCode,
      newPassword,
      confirmation: 'RESTORE VAULT',
    })
    expect((vaultContext.value as { setup: ReturnType<typeof vi.fn> }).setup).not.toHaveBeenCalled()
  })

  it('returns from clean-machine recovery with the visible Back action', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'restore',
    ))))

    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'back',
    ))))

    expect(findByAttribute(rootElement, 'data-onboarding-step', 'welcome')).not.toBeNull()
  })

  it('returns from clean-machine recovery when Escape is pressed', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'data-onboarding-action',
      'restore',
    ))))

    await act(async () => keydownListener?.(Object.assign(new Event('keydown'), { key: 'Escape' }) as KeyboardEvent))

    expect(findByAttribute(rootElement, 'data-onboarding-step', 'welcome')).not.toBeNull()
  })
})

async function renderSetup(onSetupDestination = vi.fn()) {
  root = createRoot(rootElement as unknown as Element)
  await act(async () => root?.render(createElement(SetupScreen, { onSetupDestination })))
}

function changeInput(input: StubElement, value: string) {
  input.value = value
  Simulate.change(input as unknown as Element, { target: { value } } as never)
}

function findByAttribute(node: StubNode, name: string, value: string): StubElement | null {
  return findElement(node, element => element.getAttribute(name) === value)
}

function findElement(node: StubNode, predicate: (element: StubElement) => boolean): StubElement | null {
  for (const child of node.childNodes) {
    if (child instanceof StubElement && predicate(child)) return child
    const nested = findElement(child, predicate)
    if (nested) return nested
  }
  return null
}

function flattenElements(node: StubNode): StubElement[] {
  const elements: StubElement[] = []
  for (const child of node.childNodes) {
    if (child instanceof StubElement) elements.push(child)
    elements.push(...flattenElements(child))
  }
  return elements
}

function requireElement(element: StubElement | null): StubElement {
  if (!element) throw new Error('Expected element was not rendered')
  return element
}
