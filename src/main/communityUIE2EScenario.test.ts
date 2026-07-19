import { describe, expect, it } from 'vitest'
import {
  ensureSensitiveCheckboxChecked,
} from './communityUIE2EScenario'
import {
  locateProjectCreationError,
  readVisibleProjectCreationError,
} from './communityUIE2EProjectMapping'

type FakeCheckbox = {
  first: () => FakeCheckbox
  waitFor: (options?: { state?: string; timeout?: number }) => Promise<void>
  isChecked: () => Promise<boolean>
  check: () => Promise<void>
}

type FakeDialog = {
  getByRole: (role: string, options: { name: string; exact?: boolean }) => FakeCheckbox
  locator: (selector: string) => FakeCheckbox
}

type FakeError = {
  waitFor: (options?: { state?: string; timeout?: number }) => Promise<void>
  innerText: () => Promise<string>
}

type FakeProjectCreationError = FakeError & {
  first: () => FakeProjectCreationError
}

describe('Community UI E2E scenario synchronization helpers', () => {
  it('targets the exact Sensitive checkbox, waits for visibility, checks conditionally, and converges', async () => {
    const events: string[] = []
    let checked = false
    let checkCalls = 0
    let isCheckedCalls = 0
    const checkbox: FakeCheckbox = {
      first: () => {
        events.push('first')
        return checkbox
      },
      waitFor: options => {
        events.push(`wait:${options?.state}:${options?.timeout}`)
        return Promise.resolve()
      },
      isChecked: async () => {
        isCheckedCalls += 1
        events.push(`checked:${checked}`)
        return checked
      },
      check: async () => {
        checkCalls += 1
        events.push('check')
        checked = true
      },
    }
    let role = ''
    let roleOptions: { name: string; exact?: boolean } | undefined
    let broadLocatorCalls = 0
    const dialog: FakeDialog = {
      getByRole: (receivedRole, options) => {
        role = receivedRole
        roleOptions = options
        return checkbox
      },
      locator: () => {
        broadLocatorCalls += 1
        return checkbox
      },
    }

    await ensureSensitiveCheckboxChecked(dialog)

    expect(role).toBe('checkbox')
    expect(roleOptions).toEqual({ name: 'Sensitive', exact: true })
    expect(broadLocatorCalls).toBe(0)
    expect(events.slice(0, 4)).toEqual([
      'first',
      'wait:visible:10000',
      'checked:false',
      'check',
    ])
    expect(checked).toBe(true)
    expect(checkCalls).toBe(1)
    expect(isCheckedCalls).toBeGreaterThanOrEqual(2)

    await ensureSensitiveCheckboxChecked(dialog)
    expect(checkCalls).toBe(1)
  })

  it('waits for a visible error and polls trimmed text until a nonempty exact message is available', async () => {
    const events: string[] = []
    const textValues = ['  \n\t', '  Project folder is unavailable  \n']
    const error: FakeError = {
      waitFor: options => {
        events.push(`wait:${options?.state}:${options?.timeout}`)
        return Promise.resolve()
      },
      innerText: async () => {
        events.push('innerText')
        return textValues.shift() ?? 'Project folder is unavailable'
      },
    }

    const message = await readVisibleProjectCreationError(error)

    expect(message).toBe('Project folder is unavailable')
    expect(events[0]).toBe('wait:visible:15000')
    expect(events.filter(event => event === 'innerText')).toHaveLength(2)
  })

  it('ignores the destructive Delete control when locating a project creation rejection', async () => {
    const selectors: string[] = []
    const fakeError = (text: string): FakeProjectCreationError => {
      const error: FakeProjectCreationError = {
        first: () => error,
        waitFor: () => Promise.resolve(),
        innerText: () => Promise.resolve(text),
      }
      return error
    }
    const deleteControl = fakeError('Delete')
    const creationError = fakeError('Project folder is unavailable')
    const modal = {
      locator: (selector: string) => {
        selectors.push(selector)
        return selector === '.text-danger' ? deleteControl : creationError
      },
    }

    const broadMessage = await readVisibleProjectCreationError(modal.locator('.text-danger').first())
    const scopedMessage = await readVisibleProjectCreationError(locateProjectCreationError(modal))

    expect(broadMessage).toBe('Delete')
    expect(scopedMessage).toBe('Project folder is unavailable')
    expect(selectors).toEqual([
      '.text-danger',
      'div[class~="border-danger/30"][class~="bg-danger/10"][class~="text-danger"]',
    ])
  })
})
