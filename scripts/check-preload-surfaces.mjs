import { existsSync, readFileSync } from 'fs'
import { dirname, extname, join, resolve, sep } from 'path'
import { findPrivatePreloadIpcChannelLeaks } from './open-source-config.mjs'

const menuPanelPath = join(process.cwd(), 'out', 'preload', 'menuPanel.js')
if (!existsSync(menuPanelPath)) {
  console.error(`Menu-panel preload is missing: ${menuPanelPath}`)
  process.exit(1)
}

const preloadRoot = resolve(process.cwd(), 'out', 'preload')
const visited = new Set()

function readBundleGraph(path) {
  const absolutePath = resolve(path)
  if (visited.has(absolutePath)) return ''
  if (absolutePath !== preloadRoot && !absolutePath.startsWith(`${preloadRoot}${sep}`)) {
    throw new Error(`Menu-panel preload imports outside its output root: ${absolutePath}`)
  }
  if (!existsSync(absolutePath)) throw new Error(`Menu-panel preload dependency is missing: ${absolutePath}`)
  visited.add(absolutePath)
  const bundle = readFileSync(absolutePath, 'utf8')
  let dependencies = ''
  for (const match of bundle.matchAll(/\brequire\(["'](\.[^"']+)["']\)/g)) {
    let dependencyPath = resolve(dirname(absolutePath), match[1])
    if (!extname(dependencyPath)) dependencyPath += '.js'
    dependencies += `\n${readBundleGraph(dependencyPath)}`
  }
  return `${bundle}${dependencies}`
}

const source = readBundleGraph(menuPanelPath)
const requiredChannels = [
  'menu-panel:status',
  'menu-panel:search',
  'menu-panel:copy',
  'menu-panel:reveal',
  'menu-panel:create',
  'menu-panel:action',
  'menu-panel:open-app',
  'menu-panel:close',
]
const forbiddenChannels = [
  'auth:setup',
  'auth:password',
  'vault:mutate',
  'vault:backup',
  'vault:export-json',
  'project:scan',
  'provider:test',
  'provider:list-saved',
  'vault:respond-request',
  'audit:read',
  'platform:open-external',
]

const failures = []
for (const channel of requiredChannels) {
  if (!source.includes(channel)) failures.push(`missing required channel ${channel}`)
}
for (const channel of forbiddenChannels) {
  if (source.includes(channel)) failures.push(`contains forbidden privileged channel ${channel}`)
}
for (const channel of findPrivatePreloadIpcChannelLeaks(source)) {
  failures.push(`contains forbidden private channel ${channel}`)
}

if (failures.length > 0) {
  console.error('Menu-panel preload boundary check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('Menu-panel preload boundary check passed.')
