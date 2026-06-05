import { existsSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'

const appPathArg = process.argv.slice(2).find(arg => arg !== '--')
const appPath = appPathArg || join(process.cwd(), 'dist/mac-universal/Vaultage.app')
const forbiddenKeys = [
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.cs.allow-dyld-environment-variables',
]

if (process.platform !== 'darwin') {
  console.log('macOS entitlement smoke skipped on non-darwin platform.')
  process.exit(0)
}

if (!existsSync(appPath)) {
  console.error(`Packaged app not found: ${appPath}`)
  console.error('Run pnpm dist:mac first, or pass the .app path as an argument.')
  process.exit(1)
}

const result = spawnSync('codesign', ['-d', '--entitlements', ':-', appPath], {
  encoding: 'utf8',
})
const output = `${result.stdout || ''}\n${result.stderr || ''}`

if (result.status !== 0) {
  console.error(output.trim() || 'codesign entitlement inspection failed')
  process.exit(result.status ?? 1)
}

let failed = false
if (!output.includes('com.apple.security.cs.allow-jit')) {
  console.error('Packaged app is missing com.apple.security.cs.allow-jit')
  failed = true
}

for (const key of forbiddenKeys) {
  if (output.includes(key)) {
    console.error(`Packaged app includes broad entitlement ${key}`)
    failed = true
  }
}

if (failed) process.exit(1)

console.log('Packaged macOS entitlement smoke passed.')
