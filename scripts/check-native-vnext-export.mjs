import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

const root = process.cwd()
const manifestPath = join(root, 'native-export-manifest.json')
const exportRoot = join(root, 'shared', 'VaultageCore')
const failures = []
const requireSource = process.argv.includes('--require-source')
const sourceRoot = process.env.VAULTAGE_NATIVE_SOURCE_ROOT?.trim() ?? ''

function fail(message) {
  failures.push(message)
}

function walk(directory, files = []) {
  if (!existsSync(directory)) return files
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.build' || entry.name === '.swiftpm') continue
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      fail(`export contains a symbolic link: ${relative(root, path)}`)
    } else if (entry.isDirectory()) {
      walk(path, files)
    } else if (entry.isFile()) {
      files.push(relative(root, path).split('\\').join('/'))
    } else {
      fail(`export contains an unsupported filesystem entry: ${relative(root, path)}`)
    }
  }
  return files
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error(`Native export manifest could not be read: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

if (manifest.version !== 1) fail('manifest version must be 1')
if (!/^[a-f0-9]{40}$/.test(manifest.sourceRevision ?? '')) fail('sourceRevision must be an exact Git SHA')
if (!/^[a-f0-9]{40}$/.test(manifest.sourceTree ?? '')) fail('sourceTree must be an exact Git tree')
if (manifest.provenance !== 'maintainer-attested-private-revision') {
  fail('provenance must identify the private-revision attestation model')
}
if (manifest.license !== 'Apache-2.0') fail('native export license must be Apache-2.0')
if (typeof manifest.boundary !== 'string' || manifest.boundary.length < 80) fail('manifest needs an explicit public boundary')
if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 128) {
  fail('manifest files must contain 1...128 entries')
}

const entries = new Map()
let previousPath = ''
for (const entry of manifest.files ?? []) {
  const path = entry?.path
  const digest = entry?.sha256
  if (
    typeof path !== 'string' ||
    path.includes('..') ||
    path.includes('\\') ||
    !path.startsWith('shared/VaultageCore/') ||
    !/^[A-Za-z0-9._/-]+$/.test(path)
  ) {
    fail(`invalid exported path: ${String(path)}`)
    continue
  }
  if (path <= previousPath) fail(`manifest paths are not strictly sorted at ${path}`)
  previousPath = path
  if (!/^[a-f0-9]{64}$/.test(digest ?? '')) fail(`invalid digest for ${path}`)
  if (entries.has(path)) fail(`duplicate manifest path: ${path}`)
  entries.set(path, digest)
}

const actualFiles = walk(exportRoot).sort()
const manifestFiles = [...entries.keys()]
for (const path of actualFiles) {
  if (!entries.has(path)) fail(`exported file is outside the manifest: ${path}`)
}
for (const path of manifestFiles) {
  if (!actualFiles.includes(path)) fail(`manifest path is missing: ${path}`)
}

const forbiddenContent = [
  ['private evidence path', /(?:^|[\s"'])\.omo\//m],
  ['private handoff', /CURRENT-HANDOFF/],
  ['private temporary path', /\/private\/tmp\//],
  ['WorkOS implementation', /(?:WorkOS|api\.workos\.com|auth-api\.vaultage\.dev|client_01)/i],
  ['commercial account implementation', /(?:AccountPlanStatus|CommercialAccount|CommercialPlan|CommercialEntitlement)/],
  ['billing implementation', /\bbilling\b/i],
  ['entitlement implementation', /\bentitlement\b/i],
  ['release configuration', /VaultageCommercialRelease/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ['Stripe live key', /\bsk_live_[A-Za-z0-9]{24,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
]

for (const [path, expectedDigest] of entries) {
  const absolute = join(root, path)
  if (!existsSync(absolute)) continue
  if (!lstatSync(absolute).isFile()) {
    fail(`manifest path is not a regular file: ${path}`)
    continue
  }
  if (path !== 'shared/VaultageCore/Package.swift' && !path.endsWith('.swift')) {
    fail(`unsupported exported file type: ${path}`)
  }
  const bytes = readFileSync(absolute)
  const actualDigest = createHash('sha256').update(bytes).digest('hex')
  if (actualDigest !== expectedDigest) fail(`digest mismatch for ${path}`)
  const source = bytes.toString('utf8')
  for (const [label, pattern] of forbiddenContent) {
    if (pattern.test(source)) fail(`${path} contains forbidden ${label}`)
  }
}

if (sourceRoot.length > 0) {
  const resolvedTree = spawnSync(
    'git',
    ['-C', sourceRoot, 'rev-parse', `${manifest.sourceRevision}^{tree}`],
    { encoding: 'utf8', shell: false },
  )
  if (resolvedTree.status !== 0 || resolvedTree.stdout.trim() !== manifest.sourceTree) {
    fail('private source revision does not resolve to the attested tree')
  } else {
    for (const [path, expectedDigest] of entries) {
      const source = spawnSync(
        'git',
        ['-C', sourceRoot, 'show', `${manifest.sourceRevision}:${path}`],
        { encoding: null, maxBuffer: 4 * 1024 * 1024, shell: false },
      )
      if (source.status !== 0) {
        fail(`private source revision is missing ${path}`)
        continue
      }
      const sourceDigest = createHash('sha256').update(source.stdout).digest('hex')
      if (sourceDigest !== expectedDigest) fail(`private source digest mismatch for ${path}`)
    }
  }
} else if (requireSource) {
  fail('VAULTAGE_NATIVE_SOURCE_ROOT is required for strict private-source provenance verification')
}

if (failures.length > 0) {
  console.error('Native vNext export check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

const provenance = sourceRoot.length > 0 ? 'private Git object verified' : 'committed maintainer attestation'
console.log(`Native vNext export check passed (${entries.size} manifest-bound files; ${provenance}).`)
