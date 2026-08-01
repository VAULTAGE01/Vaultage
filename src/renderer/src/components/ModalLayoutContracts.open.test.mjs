import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('./ui/dialog.tsx', import.meta.url), 'utf8')

function cssRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = indexCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm'))
  if (!match) throw new Error(`Missing ${selector} CSS rule`)
  return match[1]
}

describe('Community modal visual contracts', () => {
  it('keeps modal surfaces neutral and content-dense dialogs wide', () => {
    const overlay = cssRule('.liquid-modal-overlay')
    const shell = cssRule('.liquid-modal-shell')

    expect(overlay).toContain('var(--liquid-modal-overlay)')
    expect(shell).toContain('var(--liquid-modal-surface)')
    expect([overlay, shell]).not.toContain('saturate(')
    expect(indexCss).toContain('--liquid-modal-input:     rgb(7, 9, 10)')
    expect(dialogSource).toContain('max-w-6xl')
  })
})
