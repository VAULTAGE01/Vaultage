import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire,
} from '@electron/fuses'

const appPathArg = process.argv.slice(2).find(arg => arg !== '--')
const appPath = appPathArg || join(process.cwd(), 'dist/mac-universal/vault-OC.app')
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

const expectedFuses = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.ENABLE],
  [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
])
const checkFuseWire = (fuseWire, label) => {
  for (const [option, expectedState] of expectedFuses) {
    if (fuseWire[option] !== expectedState) {
      console.error(`Packaged Electron fuse ${FuseV1Options[option]} has an unsafe state (${label})`)
      failed = true
    }
  }
}

try {
  const frameworkPath = join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Electron Framework',
  )
  const architectureResult = spawnSync('lipo', ['-archs', frameworkPath], { encoding: 'utf8' })
  if (architectureResult.status !== 0) {
    throw new Error(architectureResult.stderr.trim() || 'could not inspect Electron framework architectures')
  }
  const architectures = architectureResult.stdout.trim().split(/\s+/).filter(Boolean)
  if (architectures.length <= 1) {
    checkFuseWire(await getCurrentFuseWire(frameworkPath), architectures[0] ?? 'thin')
  } else {
    const fuseDirectory = mkdtempSync(join(tmpdir(), 'vaultage-fuse-smoke-'))
    try {
      for (const architecture of architectures) {
        const thinFramework = join(fuseDirectory, `Electron-Framework-${architecture}`)
        const thinResult = spawnSync(
          'lipo',
          [frameworkPath, '-thin', architecture, '-output', thinFramework],
          { encoding: 'utf8' },
        )
        if (thinResult.status !== 0) {
          throw new Error(thinResult.stderr.trim() || `could not thin ${architecture} Electron framework`)
        }
        checkFuseWire(await getCurrentFuseWire(thinFramework), architecture)
      }
    } finally {
      rmSync(fuseDirectory, { recursive: true, force: true })
    }
  }
} catch (error) {
  console.error(`Could not inspect packaged Electron fuses: ${String(error)}`)
  failed = true
}

const helperPath = join(appPath, 'Contents', 'Resources', 'Vaultage Keychain')
const describeCode = path => {
  const description = spawnSync('codesign', ['-dvvv', '--', path], { encoding: 'utf8' })
  if (description.status !== 0) return null
  return `${description.stdout || ''}\n${description.stderr || ''}`
}
const identityValue = (description, name) =>
  description?.match(new RegExp(`^${name}=([^\\n]+)$`, 'm'))?.[1]?.trim() ?? null
const appDescription = describeCode(appPath)
const appTeam = identityValue(appDescription, 'TeamIdentifier')
if (!existsSync(helperPath)) {
  console.error(`Packaged native Keychain helper is missing: ${helperPath}`)
  failed = true
} else {
  const helperStat = lstatSync(helperPath)
  if (!helperStat.isFile() || helperStat.isSymbolicLink()) {
    console.error('Packaged native Keychain helper must be a regular non-symlink file')
    failed = true
  }
  if ((helperStat.mode & 0o022) !== 0 || (helperStat.mode & 0o111) === 0) {
    console.error('Packaged native Keychain helper has unsafe permissions')
    failed = true
  }

  const helperVerify = spawnSync(
    'codesign',
    ['--verify', '--strict', '--all-architectures', '--', helperPath],
    { encoding: 'utf8' },
  )
  if (helperVerify.status !== 0) {
    console.error((helperVerify.stderr || helperVerify.stdout || 'Helper signature verification failed').trim())
    failed = true
  }

  const helperDescription = describeCode(helperPath)
  const helperTeam = identityValue(helperDescription, 'TeamIdentifier')
  const appIdentifier = identityValue(appDescription, 'Identifier')
  if (!appTeam || appTeam === 'not set' || appTeam !== helperTeam) {
    console.error('Packaged app and Keychain helper must share a non-ad-hoc Apple team identity')
    failed = true
  }
  if (appIdentifier !== 'xyz.arcalab.vault-oc') {
    console.error(`Packaged app has unexpected signing identifier: ${appIdentifier ?? 'missing'}`)
    failed = true
  }
  if (!appDescription?.match(/^CodeDirectory .*flags=.*\bruntime\b/m)) {
    console.error('Packaged app signature is missing the hardened-runtime flag')
    failed = true
  }
  if (!helperDescription?.match(/^CodeDirectory .*flags=.*\bruntime\b/m)) {
    console.error('Packaged Keychain helper signature is missing the hardened-runtime flag')
    failed = true
  }
}

const resourcesRoot = join(appPath, 'Contents', 'Resources')
const packagedRelativePaths = walkRelativeFiles(resourcesRoot)
const forbiddenPackagedExtensionPath = packagedRelativePaths.find(path =>
  /(?:^|\/)(?:vaultage-native-host\.mjs|install-chrome-host\.mjs|install-host\.sh|development-extension-identity\.json)$/u.test(path)
  || /(?:^|\/)browser-extension\/(?:native-host|native-host-swift)(?:\/|$)/u.test(path)
  || /(?:^|\/)vaultage-browser-extension-.*\.(?:zip|sha256|json)$/u.test(path)
)
if (forbiddenPackagedExtensionPath) {
  console.error(`Packaged app contains a development or private extension artifact: ${forbiddenPackagedExtensionPath}`)
  failed = true
}

const infoPlist = join(appPath, 'Contents', 'Info.plist')
const contentProtectionOverride = spawnSync(
  'plutil',
  ['-extract', 'LSEnvironment.VAULTAGE_DISABLE_CONTENT_PROTECTION', 'raw', '-o', '-', infoPlist],
  { encoding: 'utf8' },
)
if (contentProtectionOverride.status === 0 && contentProtectionOverride.stdout.trim() === '1') {
  console.error('Packaged app disables window content protection through Info.plist')
  failed = true
}

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

function walkRelativeFiles(root, relative = '', result = []) {
  for (const name of readdirSync(join(root, relative))) {
    const child = relative ? join(relative, name) : name
    const stat = lstatSync(join(root, child))
    if (stat.isDirectory() && !stat.isSymbolicLink()) walkRelativeFiles(root, child, result)
    else result.push(child)
  }
  return result
}
