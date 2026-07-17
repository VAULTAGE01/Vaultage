import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { join, relative } from 'path'

const root = process.cwd()
const failures = []
const allowlistPath = join(root, 'scripts', 'source-secret-scan-allowlist.json')
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
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/g },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g },
  { name: 'OpenAI secret key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: 'Stripe live secret key', pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g },
  { name: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'Cloudflare API token label with value', pattern: /\b(?:CLOUDFLARE|CF)_[A-Z0-9_]*(?:TOKEN|KEY)\s*=\s*[A-Za-z0-9_-]{30,}/gi },
  { name: 'generic production secret assignment', pattern: /\b(?:API|AUTH|ACCESS|REFRESH|CLIENT|PRIVATE|SECRET|TOKEN|PASSWORD)_?(?:KEY|SECRET|TOKEN|PASSWORD)?\s*=\s*['"]?[A-Za-z0-9._~+/-]{40,}['"]?/gi },
]

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex')
}

function loadAllowlist() {
  if (!existsSync(allowlistPath)) return []
  const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('Source secret allowlist must be a JSON array')

  const seen = new Set()
  for (const entry of parsed) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      typeof entry.pattern !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length < 12
    ) {
      throw new Error('Every source secret allowlist entry needs path, pattern, sha256, and a specific reason')
    }
    if (entry.path.includes('..') || !/\.test\.[cm]?[jt]sx?$/.test(entry.path)) {
      throw new Error(`Secret fixture allowlist path must be a test source file: ${entry.path}`)
    }
    const key = `${entry.path}\0${entry.pattern}\0${entry.sha256}`
    if (seen.has(key)) throw new Error(`Duplicate source secret allowlist entry: ${entry.path}`)
    seen.add(key)
  }
  return parsed
}

const allowlist = loadAllowlist()
const allowlistEntries = new Map(
  allowlist.map(entry => [`${entry.path}\0${entry.pattern}\0${entry.sha256}`, entry]),
)
const usedAllowlistEntries = new Set()

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
    for (const match of source.matchAll(pattern)) {
      const sha256 = fingerprint(match[0])
      const filePath = relative(root, file).split('\\').join('/')
      const allowlistKey = `${filePath}\0${name}\0${sha256}`
      if (allowlistEntries.has(allowlistKey)) {
        usedAllowlistEntries.add(allowlistKey)
        continue
      }
      const line = source.slice(0, match.index).split('\n').length
      failures.push({ file, name, line, sha256 })
    }
  }
}

for (const [key, entry] of allowlistEntries) {
  if (!usedAllowlistEntries.has(key)) {
    failures.push({
      file: join(root, entry.path),
      name: 'stale secret fixture allowlist entry',
      line: 0,
      sha256: entry.sha256,
    })
  }
}

if (failures.length > 0) {
  console.error('Source-drop secret scan failed:')
  for (const failure of failures) {
    const location = failure.line > 0 ? `${failure.file}:${failure.line}` : failure.file
    console.error(`  - ${location}: ${failure.name} (sha256 ${failure.sha256})`)
  }
  process.exit(1)
}

console.log('Source-drop secret scan passed.')
