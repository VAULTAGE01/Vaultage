import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function componentSource(path: string): string {
  return readFileSync(join(process.cwd(), 'src/renderer/src/components', path), 'utf8')
}

function styleRule(selector: string): string {
  const source = readFileSync(join(process.cwd(), 'src/renderer/src/index.css'), 'utf8')
  const escaped = selector.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`  ${escaped} \\{([\\s\\S]*?)\\n  \\}`))
  if (!match) throw new Error(`Missing ${selector} style rule`)
  return match[1]
}

describe('modal layout widths', () => {
  it('uses a wide, viewport-safe default DialogContent container', () => {
    expect(componentSource('ui/dialog.tsx')).toContain('max-w-6xl')
  })

  it('widens content-dense Community modal flows', () => {
    expect(componentSource('AddSecretModal.open.tsx')).toContain('w-[640px] max-w-[calc(100vw-32px)]')
    expect(componentSource('ImportModal.tsx')).toContain('max-w-5xl max-h-[85vh] flex flex-col')
    expect(componentSource('ExportModal.tsx')).toContain('max-w-4xl max-h-[88vh] flex flex-col overflow-hidden')
    expect(componentSource('EnvProjectsModal.tsx').match(/w-\[min\(64rem,calc\(100vw-2rem\)\)\]/g)).toHaveLength(2)
  })

  it('keeps the private neutral modal canvas contract', () => {
    const overlay = styleRule('.liquid-modal-overlay')
    const shell = styleRule('.liquid-modal-shell')
    const sheen = styleRule('.liquid-modal-shell::before')
    const childSurfaces = [styleRule('.liquid-modal-shell .bg-bg'), styleRule('.liquid-modal-shell .bg-card'), styleRule('.liquid-modal-shell .bg-surface')]
    expect(overlay).toContain('background: var(--liquid-modal-overlay);')
    expect(shell).toContain('var(--liquid-modal-surface)')
    expect(childSurfaces.join('\\n')).toContain('var(--liquid-modal-bg)')
    expect(childSurfaces.join('\\n')).toContain('var(--liquid-modal-card)')
    expect(childSurfaces.join('\\n')).toContain('var(--liquid-modal-soft)')
    expect(childSurfaces.join('\\n')).not.toMatch(/background-color: rgba\(/)
    expect(shell).toContain('border-color: var(--liquid-border);')
    expect([overlay, shell, sheen].join('\\n')).not.toContain('radial-gradient')
  })
})
