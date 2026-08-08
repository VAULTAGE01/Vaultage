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

vi.mock('../vaultContext', () => ({
  useVault: () => vaultContext.value,
}))
vi.mock('./AuthBackdrop', () => ({
  default: () => createElement('div', { 'aria-hidden': 'true' }),
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
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = undefined
  rootElement.childNodes.splice(0)
})

describe('SetupScreen', () => {
  it('keeps the edition welcome copy and existing local-vault selector', async () => {
    await renderSetup()

    expect(rootElement.textContent).toContain('Create your local vault')
    expect(findByAttribute(rootElement, 'title', 'Create your local Vaultage vault. Shortcut: Enter')).not.toBeNull()
    if (__VAULTAGE_OPEN_CORE__) {
      expect(rootElement.textContent).toContain('Local-first Community')
      expect(rootElement.textContent).not.toContain('30-day, no-card Pro trial')
    } else {
      expect(rootElement.textContent).toContain('Local-first Free')
      expect(rootElement.textContent).toContain('30-day, no-card Pro trial')
    }
  })

  it('places the security explanation before password entry and preserves back navigation', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'title',
      'Create your local Vaultage vault. Shortcut: Enter',
    ))))

    const section = requireElement(findByAttribute(rootElement, 'aria-labelledby', 'setup-security-model-title'))
    const passwordInput = requireElement(findByAttribute(rootElement, 'placeholder', 'At least 12 characters'))
    const orderedElements = flattenElements(rootElement)

    expect(orderedElements.indexOf(section)).toBeLessThan(orderedElements.indexOf(passwordInput))
    expect(passwordInput.getAttribute('data-secure-input')).toBe('true')
    expect(findByAttribute(rootElement, 'placeholder', 'Repeat your password')?.getAttribute('data-secure-input')).toBe('true')
    expect(rootElement.textContent).toContain('Vaultage cannot reset this password')

    await act(async () => keydownListener?.(Object.assign(new Event('keydown'), { key: 'Escape' }) as KeyboardEvent))
    expect(rootElement.textContent).toContain('Create your local vault')
  })

  it('keeps vault creation disabled until both password fields are valid and matching', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findByAttribute(
      rootElement,
      'title',
      'Create your local Vaultage vault. Shortcut: Enter',
    ))))

    const createButton = requireElement(findButton(rootElement, 'Create Vault'))
    expect(createButton.getAttribute('disabled')).not.toBeNull()

    await act(async () => {
      changeInput(requireElement(findByAttribute(rootElement, 'placeholder', 'At least 12 characters')), 'correct horse battery staple')
      changeInput(requireElement(findByAttribute(rootElement, 'placeholder', 'Repeat your password')), 'correct horse battery staple')
    })

    expect(createButton.getAttribute('disabled')).toBeNull()
    await act(async () => click(rootElement, createButton))
    expect((vaultContext.value as { setup: ReturnType<typeof vi.fn> }).setup).toHaveBeenCalledOnce()
    expect((vaultContext.value as { setup: ReturnType<typeof vi.fn> }).setup).toHaveBeenCalledWith('correct horse battery staple')
  })

  it('offers clean-machine recovery from the first screen', async () => {
    await renderSetup()
    await act(async () => click(rootElement, requireElement(findButton(
      rootElement,
      'Restore an encrypted backup with an Emergency Kit',
    ))))

    expect(rootElement.textContent).toContain('Restore on this Mac')
    expect(findByAttribute(rootElement, 'placeholder', 'VLT1-…')?.getAttribute('data-secure-input')).toBe('true')
    expect(rootElement.textContent).toContain('exact vault binding')
    expect(findButton(rootElement, 'Choose encrypted backup')?.getAttribute('disabled')).not.toBeNull()
  })
})

async function renderSetup() {
  root = createRoot(rootElement as unknown as Element)
  await act(async () => root?.render(createElement(SetupScreen)))
}

function changeInput(input: StubElement, value: string) {
  input.value = value
  Simulate.change(input as unknown as Element, { target: { value } } as never)
}

function findButton(node: StubNode, label: string): StubElement | null {
  return findElement(node, element => element.tagName.toLowerCase() === 'button' && element.textContent === label)
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
