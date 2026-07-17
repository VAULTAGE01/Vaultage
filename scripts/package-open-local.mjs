import { spawnSync } from 'child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { platform } from 'process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appName = 'vault-OC'
const bundleId = 'xyz.arcalab.vault-oc'
const tmpApp = '/tmp/vault-OC.app'
const destApp = process.env['VAULTAGE_OPEN_APP_DEST'] || '/Applications/vault-OC.app'
const shouldBuild = !process.argv.includes('--no-build')
const shouldOpen = !process.argv.includes('--no-open')
const sourcePackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const appVersion = sourcePackage.version

if (platform !== 'darwin') {
  console.error('package-open-local currently supports macOS app bundles only.')
  process.exit(1)
}

function run(cmd, args, options = {}) {
  console.log(`→ ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env },
    stdio: 'inherit',
    shell: false,
    ...options,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function commandExists(cmd) {
  return spawnSync('/usr/bin/env', ['which', cmd], { stdio: 'ignore' }).status === 0
}

function isRunning() {
  return spawnSync('pgrep', ['-x', appName], { stdio: 'ignore' }).status === 0
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function quitRunningApp() {
  if (!isRunning()) return
  spawnSync('osascript', ['-e', `tell application id "${bundleId}" to quit`], { stdio: 'ignore' })
  for (let i = 0; i < 20; i += 1) {
    if (!isRunning()) return
    sleep(250)
  }
  spawnSync('pkill', ['-x', appName], { stdio: 'ignore' })
  for (let i = 0; i < 20; i += 1) {
    if (!isRunning()) return
    sleep(250)
  }
  if (isRunning()) {
    console.error(`${appName} is still running; quit it before packaging.`)
    process.exit(1)
  }
}

function writeInfoPlist(target) {
  writeFileSync(target, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${appVersion}</string>
  <key>CFBundleVersion</key>
  <string>${appVersion}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>AtomApplication</string>
  <key>NSQuitAlwaysKeepsWindows</key>
  <false/>
  <key>NSRequiresAquaSystemAppearance</key>
  <false/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key>
    <false/>
    <key>NSAllowsArbitraryLoadsInWebContent</key>
    <false/>
  </dict>
  <key>LSEnvironment</key>
  <dict>
    <key>MallocNanoZone</key>
    <string>0</string>
  </dict>
</dict>
</plist>
`)
}

function writeAppPackage(target) {
  const appPackage = {
    name: 'vaultage-open-local',
    productName: appName,
    version: appVersion,
    description: 'Encrypted key/secret vault with Touch ID',
    license: 'Apache-2.0',
    main: sourcePackage.main ?? 'out/main/index.js',
  }
  writeFileSync(target, `${JSON.stringify(appPackage, null, 2)}\n`)
}

if (shouldBuild) run('pnpm', ['build:open-local'])

const electronApp = join(root, 'node_modules/electron/dist/Electron.app')
const outDir = join(root, 'out')
const helperPath = join(root, 'resources/vault-keychain')
const iconPath = join(root, 'resources/icon.icns')

if (!existsSync(electronApp)) throw new Error(`Missing Electron.app at ${electronApp}`)
if (!existsSync(outDir)) throw new Error('Missing out/ build output; run pnpm build:open-local first.')
if (!existsSync(helperPath)) throw new Error('Missing resources/vault-keychain; run pnpm build:helper first.')
if (!existsSync(iconPath)) throw new Error('Missing resources/icon.icns.')

quitRunningApp()

console.log(`→ Assembling ${tmpApp}`)
rmSync(tmpApp, { recursive: true, force: true })
run('ditto', [electronApp, tmpApp])

renameSync(join(tmpApp, 'Contents/MacOS/Electron'), join(tmpApp, `Contents/MacOS/${appName}`))
writeInfoPlist(join(tmpApp, 'Contents/Info.plist'))

const resourcesDir = join(tmpApp, 'Contents/Resources')
const appResourcesDir = join(resourcesDir, 'app')

rmSync(join(resourcesDir, 'electron.icns'), { force: true })
cpSync(iconPath, join(resourcesDir, 'icon.icns'))
cpSync(helperPath, join(resourcesDir, 'Vaultage Keychain'))
chmodSync(join(resourcesDir, 'Vaultage Keychain'), 0o755)

rmSync(join(resourcesDir, 'default_app.asar'), { force: true })
mkdirSync(appResourcesDir, { recursive: true })
cpSync(outDir, join(appResourcesDir, 'out'), { recursive: true })
writeAppPackage(join(appResourcesDir, 'package.json'))

if (commandExists('codesign')) {
  run('codesign', ['--force', '--sign', '-', '--timestamp=none', join(resourcesDir, 'Vaultage Keychain')])
  run('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    '--entitlements',
    join(root, 'build/entitlements.mac.plist'),
    tmpApp,
  ])
  run('codesign', ['--verify', '--deep', '--strict', tmpApp])
}

console.log(`→ Installing ${destApp}`)
rmSync(destApp, { recursive: true, force: true })
run('ditto', [tmpApp, destApp])
rmSync(tmpApp, { recursive: true, force: true })

if (shouldOpen) run('open', [destApp])

console.log(`✓ ${appName} installed at ${destApp}`)
