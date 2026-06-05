import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { helperPath, IS_MAC } from './keychain'

type SecureInputResult = {
  success: boolean
  available: boolean
  error?: string
}

let secureInputHold: ChildProcessWithoutNullStreams | null = null
let secureInputStart: Promise<SecureInputResult> | null = null

export function enableSecureInput(): Promise<SecureInputResult> {
  if (!IS_MAC) return Promise.resolve({ success: true, available: false })
  if (secureInputHold) return Promise.resolve({ success: true, available: true })
  if (secureInputStart) return secureInputStart

  try {
    const child = spawn(helperPath(), ['secure-input', 'hold'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    secureInputHold = child

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk).slice(0, 1000)
    })

    secureInputStart = new Promise((resolve) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout>

      const finish = (result: SecureInputResult) => {
        if (settled) return
        settled = true
        secureInputStart = null
        clearTimeout(timeout)
        resolve(result)
      }

      timeout = setTimeout(() => {
        if (secureInputHold === child) secureInputHold = null
        child.kill('SIGKILL')
        finish({ success: false, available: true, error: 'Secure Event Input helper timed out' })
      }, 2_000)
      timeout.unref()

      child.stdout.once('data', (chunk) => {
        if (String(chunk).includes('ready')) {
          finish({ success: true, available: true })
        }
      })

      child.once('exit', (code) => {
        if (secureInputHold === child) secureInputHold = null
        if (!settled) {
          finish({
            success: false,
            available: true,
            error: stderr.trim() || `Secure Event Input helper exited with code ${code}`,
          })
        } else if (code && stderr.trim()) {
          console.warn(stderr.trim())
        }
      })

      child.once('error', (err) => {
        if (secureInputHold === child) secureInputHold = null
        finish({ success: false, available: true, error: String(err) })
      })
    })

    return secureInputStart
  } catch (err) {
    secureInputHold = null
    return Promise.resolve({ success: false, available: true, error: String(err) })
  }
}

export function disableSecureInput(): SecureInputResult {
  if (!IS_MAC) return { success: true, available: false }
  const child = secureInputHold
  if (!child) return { success: true, available: true }
  secureInputHold = null

  try {
    child.stdin.end('disable\n')
    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, 1_000)
    timer.unref()
    return { success: true, available: true }
  } catch (err) {
    return { success: false, available: true, error: String(err) }
  }
}

export function setSecureInputEnabled(enabled: boolean): Promise<SecureInputResult> | SecureInputResult {
  return enabled ? enableSecureInput() : disableSecureInput()
}
