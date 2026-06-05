import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const failures = []
const skippedDirs = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  '.vite',
  '.vaultage-open-source',
])
const skippedExtensions = new Set([
  '.glb',
  '.icns',
  '.ico',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.pdf',
  '.zip',
  '.dmg',
  '.exe',
])

const secretPatterns = [
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { name: 'OpenAI secret key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Stripe live secret key', pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
  { name: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'Cloudflare API token label with value', pattern: /\b(?:CLOUDFLARE|CF)_[A-Z0-9_]*(?:TOKEN|KEY)\s*=\s*[A-Za-z0-9_-]{30,}/i },
  { name: 'generic production secret assignment', pattern: /\b(?:API|AUTH|ACCESS|REFRESH|CLIENT|PRIVATE|SECRET|TOKEN|PASSWORD)_?(?:KEY|SECRET|TOKEN|PASSWORD)?\s*=\s*['"]?[A-Za-z0-9._~+/-]{40,}['"]?/i },
]

function extension(path) {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index).toLowerCase() : ''
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) walk(join(dir, entry.name), files)
      continue
    }
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    if (!skippedExtensions.has(extension(path))) files.push(path)
  }
  return files
}

function isTextFile(path) {
  const stat = statSync(path)
  if (stat.size > 2 * 1024 * 1024) return false
  const sample = readFileSync(path)
  return !sample.subarray(0, Math.min(sample.length, 4096)).includes(0)
}

for (const file of walk(root)) {
  if (!isTextFile(file)) continue
  const source = readFileSync(file, 'utf8')
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(source)) failures.push({ file, name })
  }
}

if (failures.length > 0) {
  console.error('Source-drop secret scan failed:')
  for (const failure of failures) {
    console.error(`  - ${failure.file}: ${failure.name}`)
  }
  process.exit(1)
}

console.log('Source-drop secret scan passed.')
