import { existsSync, mkdtempSync, rmSync } from 'fs'
import { spawn } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'

const appPathArg = process.argv.slice(2).find(arg => arg !== '--')
const appPath = appPathArg || join(process.cwd(), 'dist/mac-universal/Vaultage.app')

if (process.platform !== 'darwin') {
  console.log('Packaged app launch smoke skipped on non-darwin platform.')
  process.exit(0)
}

const executable = join(appPath, 'Contents/MacOS/Vaultage')
if (!existsSync(executable)) {
  console.error(`Packaged app executable not found: ${executable}`)
  process.exit(1)
}

const userDataDir = mkdtempSync(join(tmpdir(), 'vaultage-packaged-smoke-'))
const child = spawn(executable, [
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-first-run',
], {
  env: {
    ...process.env,
    VAULTAGE_DISABLE_AUTO_UPDATE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
const appendOutput = chunk => {
  if (output.length < 32_000) output += chunk.toString()
}
child.stdout.on('data', appendOutput)
child.stderr.on('data', appendOutput)

const result = await new Promise(resolve => {
  let settled = false
  let exited = false
  const finish = value => {
    if (settled) return
    settled = true
    resolve(value)
  }

  const earlyExit = (code, signal) => {
    exited = true
    finish({
    ok: false,
    error: new Error(`Packaged app exited before the five-second launch window (code ${code}, signal ${signal})`),
    })
  }
  child.once('error', error => finish({ ok: false, error }))
  child.once('exit', earlyExit)

  setTimeout(() => {
    child.removeListener('exit', earlyExit)
    const forceKill = setTimeout(() => {
      if (!exited) child.kill('SIGKILL')
      finish({ ok: true })
    }, 2_000)
    child.once('exit', () => {
      exited = true
      clearTimeout(forceKill)
      finish({ ok: true })
    })
    child.kill('SIGTERM')
  }, 5_000)
})

rmSync(userDataDir, { recursive: true, force: true })

if (!result.ok) {
  console.error(result.error instanceof Error ? result.error.message : String(result.error))
  if (output.trim()) console.error(output.trim())
  process.exit(1)
}

console.log('Packaged macOS app stayed healthy through the launch smoke window.')
