import { useEffect } from 'react'

function getProtectedInput(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  const candidate = target.closest('input, textarea')
  if (
    !(candidate instanceof HTMLInputElement) &&
    !(candidate instanceof HTMLTextAreaElement)
  ) {
    return null
  }

  if (candidate.dataset.secureInput === 'true') return candidate
  if (candidate instanceof HTMLInputElement && candidate.type === 'password') return candidate
  return null
}

export default function SecureInputBridge() {
  useEffect(() => {
    let activeInput: HTMLElement | null = null
    let enabled = false

    const setSecureInput = (next: boolean) => {
      if (enabled === next) return
      enabled = next
      void window.vault.setSecureInputEnabled(next).catch(() => {
        enabled = !next
      })
    }

    const refreshFromActiveElement = () => {
      const nextInput = document.hasFocus()
        ? getProtectedInput(document.activeElement)
        : null
      activeInput = nextInput
      setSecureInput(Boolean(nextInput))
    }

    const handleFocusIn = (event: FocusEvent) => {
      const nextInput = getProtectedInput(event.target)
      if (!nextInput) return
      activeInput = nextInput
      setSecureInput(true)
    }

    const handleFocusOut = (event: FocusEvent) => {
      const leavingInput = getProtectedInput(event.target)
      if (!leavingInput || leavingInput !== activeInput) return
      window.setTimeout(refreshFromActiveElement, 0)
    }

    const handleWindowBlur = () => {
      activeInput = null
      setSecureInput(false)
    }

    const handleWindowFocus = () => {
      window.setTimeout(refreshFromActiveElement, 0)
    }

    const handleVisibilityChange = () => {
      if (document.hidden) handleWindowBlur()
      else refreshFromActiveElement()
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)
    refreshFromActiveElement()

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('focus', handleWindowFocus)
      setSecureInput(false)
    }
  }, [])

  return null
}
