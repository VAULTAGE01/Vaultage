import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function componentSource(path: string): string {
  return readFileSync(join(process.cwd(), 'src/renderer/src/components', path), 'utf8')
}

function styleRule(selector: string): string {
  const source = readFileSync(join(process.cwd(), 'src/renderer/src/index.css'), 'utf8')
  const match = source.match(new RegExp(`  ${selector.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\n  \\}`))
  if (!match) throw new Error(`Missing ${selector} style rule`)
  return match[1]
}

describe('modal layout widths', () => {
  it('uses a wide, viewport-safe default DialogContent container', () => {
    const source = componentSource('ui/dialog.tsx')

    expect(source).toContain("'max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-5xl'")
  })

  it('widens content-dense modal flows without changing compact dialogs', () => {
    const addSecretSource = componentSource('AddSecretModal.open.tsx')
    const importSource = componentSource('ImportModal.tsx')
    const exportSource = componentSource('ExportModal.tsx')
    const projectsSource = componentSource('EnvProjectsModal.tsx')

    expect(addSecretSource).toContain('w-[640px] max-w-[calc(100vw-32px)]')
    expect(importSource).toContain('max-w-5xl max-h-[85vh] flex flex-col')
    expect(exportSource).toContain('max-w-4xl max-h-[88vh] flex flex-col overflow-hidden')
    expect(projectsSource.match(/w-\[960px\] max-w-\[calc\(100vw-32px\)\]/g)).toHaveLength(2)
  })

  it('keeps modal canvas layers neutral while retaining their glass treatment', () => {
    const overlay = styleRule('.liquid-modal-overlay')
    const shell = styleRule('.liquid-modal-shell')
    const sheen = styleRule('.liquid-modal-shell::before')

    expect(overlay).toContain('background: rgba(0,0,0,0.56);')
    expect(shell).toContain('rgba(2,8,6,0.74)')
    expect(shell).toContain('border-color: var(--liquid-border);')
    expect([overlay, shell, sheen].join('\n')).not.toContain('radial-gradient')
  })
})
