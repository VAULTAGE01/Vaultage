import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SetupSecurityModel } from './SetupSecurityModel'

describe('SetupSecurityModel', () => {
  it('renders three non-interactive security facts as a labelled section', () => {
    const markup = renderToStaticMarkup(<SetupSecurityModel />)

    expect(markup).toContain('aria-labelledby="setup-security-model-title"')
    expect(markup).toContain('<ul')
    expect(markup.match(/data-onboarding-security-fact="true"/g)).toHaveLength(3)
    expect(markup).not.toMatch(/<(?:button|input|a)\b/)
  })

})
