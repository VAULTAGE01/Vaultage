import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'

const root = process.cwd()
const appPath = process.argv[2] || join(root, 'dist', 'mac-universal', 'Vaultage Community.app')
const helperPath = join(appPath, 'Contents', 'Resources', 'Vaultage Community Keychain')
const infoPlistPath = join(appPath, 'Contents', 'Info.plist')
const expectedBundleId = 'xyz.arcalab.vaultage.community'
const expectedBundleName = 'Vaultage Community'

const failures = []

function fail(message) {
  failures.push(message)
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  })
  if (result.status !== 0) {
    fail(`${label} failed: ${(result.stderr || result.stdout || '').trim()}`)
  }
  return result
}

function readPlistValue(key) {
  const result = run(`read ${key}`, 'plutil', ['-extract', key, 'raw', '-o', '-', infoPlistPath])
  return result.status === 0 ? result.stdout.trim() : ''
}

if (!existsSync(appPath)) {
  fail(`App bundle missing: ${appPath}`)
} else if (!statSync(appPath).isDirectory()) {
  fail(`App bundle path is not a directory: ${appPath}`)
}

if (!existsSync(helperPath)) {
  fail(`Packaged Keychain helper missing: ${helperPath}`)
}

if (existsSync(infoPlistPath)) {
  const bundleId = readPlistValue('CFBundleIdentifier')
  const bundleName = readPlistValue('CFBundleName')
  if (bundleId !== expectedBundleId) {
    fail(`Unexpected CFBundleIdentifier ${bundleId}; expected ${expectedBundleId}`)
  }
  if (bundleName !== expectedBundleName) {
    fail(`Unexpected CFBundleName ${bundleName}; expected ${expectedBundleName}`)
  }
}

if (existsSync(appPath)) {
  run('codesign verification', 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  run('notarization staple validation', 'xcrun', ['stapler', 'validate', appPath])
  run('Gatekeeper assessment', 'spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
}

if (failures.length > 0) {
  console.error('macOS release assertion failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('macOS release assertion passed.')
