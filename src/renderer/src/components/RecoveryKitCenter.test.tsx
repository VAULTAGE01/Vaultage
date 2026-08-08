import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../vaultContext', () => ({
  useVault: () => ({
    clearPendingRecoveryKit: vi.fn(),
    state: { pendingRecoveryKit: null },
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children, variant: _variant, ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: string }) => <div {...props}>{children}</div>,
  AlertDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => <button {...props}>{children}</button>,
}))
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange: _onCheckedChange, ...props }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" role="checkbox" aria-checked={checked ? 'true' : 'false'} {...props} />
  ),
}))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
  DialogHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
}))
vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))
vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}))

import * as recoveryKitModule from './RecoveryKitCenter'

const material = {
  format: 'vaultage.recovery-kit.v1' as const,
  generation: 'generation-1',
  createdAt: '2026-08-06T12:00:00.000Z',
  vaultFingerprint: 'vault-1234',
  recoveryCode: 'VLT1-TEST-RECOVERY-CODE',
}

describe('Recovery Kit initial setup acknowledgement', () => {
  it('continues after acknowledgement without requiring a PDF or code re-entry', () => {
    const canContinue = Reflect.get(recoveryKitModule, 'canContinueInitialRecoveryKit')
    const MaterialStep = Reflect.get(recoveryKitModule, 'RecoveryKitMaterialStep')

    expect(canContinue).toBeTypeOf('function')
    expect(canContinue(false, false)).toBe(false)
    expect(canContinue(true, false)).toBe(true)
    expect(canContinue(true, true)).toBe(false)
    expect(MaterialStep).toBeTypeOf('function')

    const markup = renderToStaticMarkup(createElement(MaterialStep, {
      acknowledged: false,
      busy: false,
      material,
      onAcknowledgementChange: vi.fn(),
      onContinue: vi.fn(),
      onSavePdf: vi.fn(),
      pdfSaved: false,
    }))

    expect(markup).toContain(material.recoveryCode)
    expect(markup).toContain('I saved this recovery code somewhere safe and understand Vaultage cannot recreate it.')
    expect(markup).not.toContain('Emergency Kit code verification')
    expect(markup).not.toContain('Verify code')
    expect(markup).toContain('disabled="">Continue</button>')
  })
})
