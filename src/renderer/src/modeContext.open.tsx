import React, { createContext, useContext, useEffect, useState } from 'react'

export type AppMode = 'local' | 'projects'

interface ModeCtx {
  mode: AppMode
  setMode: (mode: AppMode) => Promise<void>
  selectedProjectId: string | null
  setSelectedProjectId: (id: string | null) => void
}

const ModeContext = createContext<ModeCtx>({
  mode: 'local',
  setMode: async () => {},
  selectedProjectId: null,
  setSelectedProjectId: () => {},
})

function fromWireMode(value: unknown): AppMode {
  return value === 'agent' ? 'projects' : 'local'
}

function toWireMode(mode: AppMode): string {
  return mode === 'projects' ? 'agent' : 'local'
}

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<AppMode>('local')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    window.vault.getMode()
      .then(value => {
        if (mounted) setModeState(fromWireMode(value))
      })
      .catch(() => {})
    const off = window.vault.onModeChange(value => setModeState(fromWireMode(value)))
    return () => {
      mounted = false
      off()
    }
  }, [])

  const setMode = async (nextMode: AppMode) => {
    const result = await window.vault.setMode(toWireMode(nextMode))
    if (result?.success !== false) setModeState(nextMode)
  }

  return (
    <ModeContext.Provider value={{
      mode,
      setMode,
      selectedProjectId,
      setSelectedProjectId,
    }}>
      {children}
    </ModeContext.Provider>
  )
}

export function useMode() {
  return useContext(ModeContext)
}
