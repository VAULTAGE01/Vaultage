import { useEffect } from 'react'
import { isModKey } from '../lib/keyboard'
import type { AppMode } from '../modeContext.open'

type Options = {
  mode: AppMode
  targetFolderId: string | undefined
  onNewProject: () => void
  onNewSecret: () => void
  onImport: () => void
  onExport: () => void
  onSettings: () => void
  onShortcuts: () => void
}

export function useCommunitySidebarShortcuts(options: Options): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isModKey(event) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        if (options.mode === 'projects') options.onNewProject()
        else if (options.targetFolderId) options.onNewSecret()
        return
      }
      if (key === 'i' && event.shiftKey) {
        event.preventDefault()
        options.onImport()
        return
      }
      if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        options.onExport()
        return
      }
      if (key === ',' && !event.shiftKey) {
        event.preventDefault()
        options.onSettings()
        return
      }
      if (key === '/' && !event.shiftKey) {
        event.preventDefault()
        options.onShortcuts()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [options])
}
