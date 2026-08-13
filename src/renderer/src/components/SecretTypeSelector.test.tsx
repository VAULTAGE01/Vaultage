import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import SecretTypeSelector, { nextSecretTypeForKey } from './SecretTypeSelector'

describe('SecretTypeSelector', () => {
  it('renders all secret types as a labelled radio group with one selected item', () => {
    const html = renderToStaticMarkup(
      <SecretTypeSelector value="password" onChange={vi.fn()} />,
    )

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Secret type"')
    expect(html.match(/role="radio"/g)).toHaveLength(7)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toContain('Password')
    expect(html).toContain('API Key')
    expect(html).toContain('Secure Note')
    expect(html).toContain('Certificate')
    expect(html).not.toContain('truncate')
  })

  it('supports arrows plus Home and End without trapping unrelated keys', () => {
    expect(nextSecretTypeForKey('password', 'ArrowRight')).toBe('apiKey')
    expect(nextSecretTypeForKey('password', 'ArrowLeft')).toBe('certificate')
    expect(nextSecretTypeForKey('custom', 'Home')).toBe('password')
    expect(nextSecretTypeForKey('custom', 'End')).toBe('certificate')
    expect(nextSecretTypeForKey('custom', 'Tab')).toBe('custom')
  })
})
