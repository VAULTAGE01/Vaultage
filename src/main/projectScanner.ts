import { constants, promises as fs } from 'fs'
import type { Dirent } from 'fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import {
  MAX_PROJECT_MANUAL_FILES,
  type ProjectDiscoverRequest,
  type ProjectDiscoverResult,
  type ProjectScanEnvFile,
  type ProjectScanEnvKey,
  type ProjectScanCandidate,
  type ProjectScanFileRef,
  type ProjectScanProjectType,
  type ProjectScanRequest,
  type ProjectScanResult,
  type ProjectScanService,
} from '../shared/projectScan'

const MAX_SCAN_FILES = 1_200
const MAX_DISCOVERY_DIRS = 32
const MAX_DISCOVERY_CANDIDATES = 12
const MAX_FILE_BYTES = 512 * 1024
const MAX_MANUAL_FILE_BYTES = 1024 * 1024
const MAX_MANUAL_TOTAL_BYTES = 8 * 1024 * 1024
const MAX_SCAN_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_READ_CONCURRENCY = 8
const MAX_ENV_VALUE_CHARS = 16_384

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.vercel',
  '.cache',
  '.parcel-cache',
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'coverage',
  'target',
  'out',
  '.venv',
  'venv',
  '__pycache__',
  'Pods',
  'DerivedData',
])

const SCANNABLE_EXTENSIONS = new Set([
  '.cjs', '.conf', '.config', '.cs', '.css', '.dart', '.env', '.go',
  '.java', '.js', '.json', '.jsx', '.kt', '.mjs', '.php', '.properties',
  '.py', '.rb', '.rs', '.sh', '.swift', '.toml', '.ts', '.tsx', '.vue',
  '.yaml', '.yml',
])

const SCANNABLE_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.staging',
  '.env.test',
  '.npmrc',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'Podfile',
  'wrangler.toml',
  'vercel.json',
  'netlify.toml',
  'firebase.json',
  'eas.json',
  'app.json',
  'app.config.js',
  'app.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'svelte.config.js',
  'astro.config.mjs',
  'remix.config.js',
  'tauri.conf.json',
  'project.godot',
])

const ENV_REFERENCE_PATTERNS: RegExp[] = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]{1,})\b/g,
  /\bprocess\.env\[['"`]([A-Z][A-Z0-9_]{1,})['"`]\]/g,
  /\bimport\.meta\.env\.([A-Z][A-Z0-9_]{1,})\b/g,
  /\bDeno\.env\.get\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\bos\.environ(?:\.get)?\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\bos\.getenv\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\bENV\[['"`]([A-Z][A-Z0-9_]{1,})['"`]\]/g,
  /\benv\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\bgetenv\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\bos\.Getenv\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\b(?:std::)?env::var\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\bSystem\.getenv\(['"`]([A-Z][A-Z0-9_]{1,})['"`]\)/g,
  /\$\{\{\s*secrets\.([A-Z][A-Z0-9_]{1,})\s*\}\}/g,
  /\$\{([A-Z][A-Z0-9_]{1,})(?::[-?][^}]*)?\}/g,
]

const SERVICE_RULES: {
  id: string
  label: string
  keyPatterns: RegExp[]
  dependencyPatterns?: RegExp[]
}[] = [
  { id: 'openai', label: 'OpenAI', keyPatterns: [/^OPENAI_/, /^AZURE_OPENAI_/], dependencyPatterns: [/(^|\/)openai$/i, /@azure\/openai/i] },
  { id: 'anthropic', label: 'Anthropic', keyPatterns: [/^ANTHROPIC_/, /^CLAUDE_/], dependencyPatterns: [/@anthropic-ai\/sdk/i] },
  { id: 'gemini', label: 'Google Gemini', keyPatterns: [/^GEMINI_/, /^GOOGLE_GENERATIVE_AI_/, /^GOOGLE_AI_/], dependencyPatterns: [/@google\/generative-ai/i, /google-genai/i] },
  { id: 'deepseek', label: 'DeepSeek', keyPatterns: [/^DEEPSEEK_/] },
  { id: 'stripe', label: 'Stripe', keyPatterns: [/^STRIPE_/, /^NEXT_PUBLIC_STRIPE_/], dependencyPatterns: [/(^|\/)stripe$/i, /@stripe\//i] },
  { id: 'cloudflare', label: 'Cloudflare', keyPatterns: [/^CLOUDFLARE_/, /^CF_/], dependencyPatterns: [/wrangler/i, /@cloudflare\//i] },
  { id: 'vercel', label: 'Vercel', keyPatterns: [/^VERCEL_/], dependencyPatterns: [/vercel/i] },
  { id: 'railway', label: 'Railway', keyPatterns: [/^RAILWAY_/, /^RAILWAY$/] },
  { id: 'aws', label: 'AWS', keyPatterns: [/^AWS_/, /^S3_/], dependencyPatterns: [/@aws-sdk\//i, /boto3/i] },
  { id: 'github', label: 'GitHub', keyPatterns: [/^GITHUB_/, /^GH_/, /^GIT_.*TOKEN/], dependencyPatterns: [/@octokit\//i] },
  { id: 'gitlab', label: 'GitLab', keyPatterns: [/^GITLAB_/] },
  { id: 'linear', label: 'Linear', keyPatterns: [/^LINEAR_/] },
  { id: 'slack', label: 'Slack', keyPatterns: [/^SLACK_/, /^XOX[ABPR]-/] },
  { id: 'discord', label: 'Discord', keyPatterns: [/^DISCORD_/] },
  { id: 'twilio', label: 'Twilio', keyPatterns: [/^TWILIO_/], dependencyPatterns: [/(^|\/)twilio$/i] },
  { id: 'resend', label: 'Resend', keyPatterns: [/^RESEND_/], dependencyPatterns: [/(^|\/)resend$/i] },
  { id: 'sendgrid', label: 'SendGrid', keyPatterns: [/^SENDGRID_/], dependencyPatterns: [/@sendgrid\//i] },
  { id: 'sentry', label: 'Sentry', keyPatterns: [/^SENTRY_/, /SENTRY_DSN/], dependencyPatterns: [/@sentry\//i] },
  { id: 'posthog', label: 'PostHog', keyPatterns: [/^POSTHOG_/, /^NEXT_PUBLIC_POSTHOG_/], dependencyPatterns: [/posthog-js/i, /posthog-node/i] },
  { id: 'supabase', label: 'Supabase', keyPatterns: [/^SUPABASE_/, /^NEXT_PUBLIC_SUPABASE_/], dependencyPatterns: [/@supabase\//i] },
  { id: 'firebase', label: 'Firebase', keyPatterns: [/^FIREBASE_/, /^NEXT_PUBLIC_FIREBASE_/], dependencyPatterns: [/firebase/i, /firebase-admin/i] },
  { id: 'clerk', label: 'Clerk', keyPatterns: [/^CLERK_/, /^NEXT_PUBLIC_CLERK_/], dependencyPatterns: [/@clerk\//i] },
  { id: 'auth0', label: 'Auth0', keyPatterns: [/^AUTH0_/], dependencyPatterns: [/@auth0\//i] },
  { id: 'database', label: 'Database', keyPatterns: [/^DATABASE_URL$/, /^POSTGRES_/, /^POSTGRESQL_/, /^MYSQL_/, /^MONGODB_/, /^MONGO_/, /^NEON_/, /^TURSO_/, /^PLANETSCALE_/] },
  { id: 'redis', label: 'Redis', keyPatterns: [/^REDIS_/, /^UPSTASH_REDIS_/, /^KV_REST_API_/], dependencyPatterns: [/redis/i, /ioredis/i, /@upstash\/redis/i] },
  { id: 'pinecone', label: 'Pinecone', keyPatterns: [/^PINECONE_/], dependencyPatterns: [/@pinecone-database\//i] },
  { id: 'qdrant', label: 'Qdrant', keyPatterns: [/^QDRANT_/], dependencyPatterns: [/@qdrant\//i] },
  { id: 'jwt', label: 'Auth/JWT', keyPatterns: [/^JWT_/, /^AUTH_SECRET$/, /^NEXTAUTH_/, /^SECRET_KEY$/] },
]

interface ScanFile {
  path: string
  manual: boolean
}

interface FileRead {
  file: ScanFile
  text: string
}

interface PreparedScanFile extends ScanFile {
  size: number
}

export interface DotenvAssignment {
  key: string
  value: string
  line: number
}

function confidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 4) return 'high'
  if (score >= 2) return 'medium'
  return 'low'
}

function normalizeKey(key: string): string | null {
  const normalized = key.trim()
  if (!/^[A-Z][A-Z0-9_]{1,}$/.test(normalized)) return null
  if (/^(NODE_ENV|PATH|HOME|PWD|SHELL|USER|TMPDIR|CI|PORT|HOST|DEBUG|LOG_LEVEL)$/.test(normalized)) return null
  return normalized
}

function environmentFromName(filePath: string): string | undefined {
  const name = basename(filePath).toLowerCase()
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.some(token => token === 'prod' || token === 'production')) return 'production'
  if (tokens.some(token => token === 'stag' || token === 'stage' || token === 'staging')) return 'staging'
  if (tokens.some(token => token === 'test' || token === 'testing')) return 'testing'
  if (tokens.some(token => token === 'dev' || token === 'development' || token === 'local')) return 'development'
  return undefined
}

function isEnvFile(filePath: string): boolean {
  const name = basename(filePath)
  return name === '.env' || name.startsWith('.env.')
}

function shouldScanFile(filePath: string): boolean {
  const name = basename(filePath)
  if (SCANNABLE_FILENAMES.has(name)) return true
  if (name.startsWith('.env.')) return true
  return SCANNABLE_EXTENSIONS.has(extname(name).toLowerCase())
}

function safeExcerpt(line: string): string {
  return line
    .replace(/(['"`])(?:\\.|[^'"`])*\1/g, '$1[redacted]$1')
    .replace(/=\s*.+$/, '= [redacted]')
    .trim()
    .slice(0, 160)
}

async function collectProjectFiles(rootPath: string): Promise<{ files: ScanFile[]; skipped: number; warnings: string[] }> {
  const files: ScanFile[] = []
  const warnings: string[] = []
  let skipped = 0

  async function walk(dir: string, depth: number) {
    if (files.length >= MAX_SCAN_FILES) return
    if (depth > 8) {
      skipped += 1
      return
    }

    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      skipped += 1
      return
    }

    entries.sort((a, b) => Number(b.isFile()) - Number(a.isFile()) || a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES) break
      const next = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        skipped += 1
        continue
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(next, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!shouldScanFile(next)) {
        skipped += 1
        continue
      }
      files.push({ path: next, manual: false })
    }
  }

  await walk(rootPath, 0)
  if (files.length >= MAX_SCAN_FILES) warnings.push(`Stopped after ${MAX_SCAN_FILES} files to keep scanning fast.`)
  return { files, skipped, warnings }
}

async function prepareScanFiles(files: ScanFile[]): Promise<{
  files: PreparedScanFile[]
  skipped: number
  warnings: string[]
}> {
  if (files.filter(file => file.manual).length > MAX_PROJECT_MANUAL_FILES) {
    throw new Error(`Choose at most ${MAX_PROJECT_MANUAL_FILES} manual scan files`)
  }

  const prepared: PreparedScanFile[] = []
  const warnings: string[] = []
  let skipped = 0
  let totalBytes = 0
  let manualBytes = 0

  for (const file of files) {
    const stat = await fs.lstat(file.path).catch(() => null)
    const maxBytes = file.manual ? MAX_MANUAL_FILE_BYTES : MAX_FILE_BYTES
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
      skipped += 1
      continue
    }
    if (file.manual && manualBytes + stat.size > MAX_MANUAL_TOTAL_BYTES) {
      skipped += 1
      if (!warnings.some(warning => warning.includes('manual-file byte budget'))) {
        warnings.push(`Skipped manual files beyond the ${formatByteLimit(MAX_MANUAL_TOTAL_BYTES)} manual-file byte budget.`)
      }
      continue
    }
    if (totalBytes + stat.size > MAX_SCAN_TOTAL_BYTES) {
      skipped += 1
      if (!warnings.some(warning => warning.includes('total scan byte budget'))) {
        warnings.push(`Stopped reading files beyond the ${formatByteLimit(MAX_SCAN_TOTAL_BYTES)} total scan byte budget.`)
      }
      continue
    }
    prepared.push({ ...file, size: stat.size })
    totalBytes += stat.size
    if (file.manual) manualBytes += stat.size
  }

  return { files: prepared, skipped, warnings }
}

async function readScanFile(file: PreparedScanFile): Promise<FileRead | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(file.path, constants.O_RDONLY | noFollowFlag())
    const pathStat = await fs.lstat(file.path)
    if (pathStat.isSymbolicLink()) return null
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== file.size) return null
    const buffer = await handle.readFile()
    if (buffer.length > file.size || buffer.includes(0)) return null
    return { file, text: buffer.toString('utf8') }
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function addSource(target: ProjectScanEnvKey, source: ProjectScanFileRef) {
  const exists = target.sources.some(item =>
    item.path === source.path &&
    item.line === source.line &&
    item.kind === source.kind &&
    item.manual === source.manual
  )
  if (!exists) target.sources.push(source)
}

export function parseDotenvValue(raw: string): string {
  const value = raw.trimStart()
  if (!value) return ''

  const quote = value[0]
  if (quote === '"' || quote === "'") {
    let parsed = ''
    let escaped = false
    for (let index = 1; index < value.length; index += 1) {
      const char = value[index]
      if (quote === '"' && escaped) {
        parsed += dotenvEscape(char)
        escaped = false
        continue
      }
      if (quote === '"' && char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) return parsed.slice(0, MAX_ENV_VALUE_CHARS)
      parsed += char
    }
    if (escaped) parsed += '\\'
    return parsed.slice(0, MAX_ENV_VALUE_CHARS)
  }

  const commentIndex = value.search(/\s+#/)
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value)
    .trimEnd()
    .slice(0, MAX_ENV_VALUE_CHARS)
}

export function parseDotenvAssignments(text: string): DotenvAssignment[] {
  const lines = text.split(/\r?\n/)
  const assignments: DotenvAssignment[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const match = lines[index].match(/^\uFEFF?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    let raw = match[2] ?? ''
    const quote = raw.trimStart()[0]
    while (
      (quote === '"' || quote === "'") &&
      !hasClosingDotenvQuote(raw.trimStart(), quote) &&
      index + 1 < lines.length
    ) {
      index += 1
      raw += `\n${lines[index]}`
    }
    assignments.push({ key: match[1], value: parseDotenvValue(raw), line: lineNumber })
  }

  return assignments
}

function hasClosingDotenvQuote(value: string, quote: '"' | "'"): boolean {
  let escaped = false
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"' && escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && char === '\\') {
      escaped = true
      continue
    }
    if (char === quote) return true
  }
  return false
}

// Must stay the exact inverse of formatDotenvValue in shared/dotenvCore, which
// escapes `$` and a backtick so a shell sourcing the exported file cannot expand
// or execute a saved field value. Decoding them back is what lets a rescan of a
// Vaultage-exported .env report the value the vault actually holds.
function dotenvEscape(char: string): string {
  if (char === 'n') return '\n'
  if (char === 'r') return '\r'
  if (char === 't') return '\t'
  if (char === '"') return '"'
  if (char === '\\') return '\\'
  if (char === '$') return '$'
  if (char === '`') return '`'
  return `\\${char}`
}

function serviceForKey(key: string): { id: string; label: string } | null {
  for (const rule of SERVICE_RULES) {
    if (rule.keyPatterns.some(pattern => pattern.test(key))) {
      return { id: rule.id, label: rule.label }
    }
  }
  return null
}

function createEnvKey(key: string): ProjectScanEnvKey {
  const service = serviceForKey(key)
  return {
    key,
    serviceId: service?.id,
    serviceLabel: service?.label,
    sources: [],
    values: [],
  }
}

function extractEnvKeys(reads: FileRead[]): { envKeys: ProjectScanEnvKey[]; envFiles: ProjectScanEnvFile[] } {
  const keys = new Map<string, ProjectScanEnvKey>()
  const envFiles: ProjectScanEnvFile[] = []

  const get = (key: string) => {
    if (!keys.has(key)) keys.set(key, createEnvKey(key))
    return keys.get(key)!
  }

  for (const read of reads) {
    const filePath = read.file.path
    const lines = read.text.split(/\r?\n/)
    const fileEnvironment = environmentFromName(filePath)
    if (isEnvFile(filePath)) {
      let envFileKeyCount = 0
      for (const assignment of parseDotenvAssignments(read.text)) {
        const key = normalizeKey(assignment.key.toUpperCase())
        if (!key) continue
        const envKey = get(key)
        envFileKeyCount += 1
        envKey.environment = envKey.environment ?? fileEnvironment
        addSource(envKey, {
          path: filePath,
          line: assignment.line,
          kind: 'env-file',
          excerpt: `${key}= [redacted]`,
          manual: read.file.manual,
        })
        if (assignment.value) {
          envKey.values.push({
            value: assignment.value,
            sourceFile: filePath,
            line: assignment.line,
            environment: fileEnvironment,
            manual: read.file.manual,
          })
        }
      }
      envFiles.push({
        path: filePath,
        environment: fileEnvironment,
        keyCount: envFileKeyCount,
        manual: read.file.manual,
      })
      continue
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const lineNumber = index + 1

      for (const pattern of ENV_REFERENCE_PATTERNS) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(line)) !== null) {
          const key = normalizeKey(match[1])
          if (!key) continue
          const envKey = get(key)
          envKey.environment = envKey.environment ?? fileEnvironment
          addSource(envKey, {
            path: filePath,
            line: lineNumber,
            kind: read.file.manual ? 'manual' : 'code-reference',
            excerpt: safeExcerpt(line),
            manual: read.file.manual,
          })
        }
      }
    }

  }

  return {
    envKeys: [...keys.values()].sort((a, b) => a.key.localeCompare(b.key)),
    envFiles: envFiles.sort((a, b) => a.path.localeCompare(b.path)),
  }
}

function readJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

function dependencyNames(reads: FileRead[]): string[] {
  const names = new Set<string>()
  for (const read of reads) {
    const name = basename(read.file.path)
    if (name === 'package.json') {
      const json = readJson(read.text)
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = json?.[key]
        if (deps && typeof deps === 'object') {
          for (const dep of Object.keys(deps)) names.add(dep)
        }
      }
    }
    if (name === 'requirements.txt') {
      for (const line of read.text.split(/\r?\n/)) {
        const dep = line.trim().split(/[=<>~\s]/)[0]
        if (dep) names.add(dep)
      }
    }
    if (name === 'pyproject.toml' || name === 'Cargo.toml' || name === 'go.mod' || name === 'Gemfile') {
      for (const line of read.text.split(/\r?\n/)) {
        const match = line.match(/^\s*["']?([A-Za-z0-9_@./-]+)["']?\s*(?:=|,|\s)/)
        if (match) names.add(match[1])
      }
    }
  }
  return [...names]
}

function inferProjectTypes(reads: FileRead[], deps: string[]): ProjectScanProjectType[] {
  const evidence = new Map<string, Set<string>>()
  const add = (label: string, item: string) => {
    if (!evidence.has(label)) evidence.set(label, new Set())
    evidence.get(label)!.add(item)
  }

  const files = new Set(reads.map(read => basename(read.file.path)))
  const paths = reads.map(read => read.file.path)
  const depText = deps.join('\n')

  if (deps.includes('next') || files.has('next.config.js') || files.has('next.config.ts') || files.has('next.config.mjs')) add('Next.js web app', 'next config/dependency')
  if (/vite/i.test(depText) || files.has('vite.config.ts') || files.has('vite.config.js')) add('Vite web app', 'vite config/dependency')
  if (/react-native|expo/i.test(depText) || files.has('eas.json') || files.has('app.json')) add('Mobile app', 'Expo/React Native evidence')
  if (/electron/i.test(depText)) add('Desktop app', 'Electron dependency')
  if (/tauri/i.test(depText) || files.has('tauri.conf.json')) add('Desktop app', 'Tauri config')
  if (/fastapi|uvicorn/i.test(depText)) add('Python API service', 'FastAPI dependency')
  if (/django/i.test(depText)) add('Django web app', 'Django dependency')
  if (/flask/i.test(depText)) add('Flask web app', 'Flask dependency')
  if (files.has('go.mod')) add('Go service', 'go.mod')
  if (files.has('Cargo.toml')) add('Rust service', 'Cargo.toml')
  if (files.has('wrangler.toml')) add('Cloudflare Workers app', 'wrangler.toml')
  if (files.has('vercel.json')) add('Vercel-deployed app', 'vercel.json')
  if (files.has('netlify.toml')) add('Netlify-deployed app', 'netlify.toml')
  if (paths.some(path => /(^|\/)ios\//.test(path) || /(^|\/)android\//.test(path))) add('Mobile app', 'ios/android folders')
  if (files.has('project.godot')) add('Game project', 'project.godot')
  if (paths.some(path => /(^|\/)(Assets|ProjectSettings)\//.test(path))) add('Game project', 'Unity-style folders')
  if (files.has('docker-compose.yml') || files.has('docker-compose.yaml') || files.has('Dockerfile')) add('Containerized service', 'Docker config')

  return [...evidence.entries()]
    .map(([label, items]) => ({
      label,
      confidence: confidence(items.size + (label.includes('web app') ? 1 : 0)),
      evidence: [...items].slice(0, 4),
    }))
    .sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 }
      return rank[b.confidence] - rank[a.confidence] || a.label.localeCompare(b.label)
    })
}

function inferServices(envKeys: ProjectScanEnvKey[], deps: string[]): ProjectScanService[] {
  const services = new Map<string, ProjectScanService>()
  const add = (id: string, label: string, evidence: string) => {
    const current = services.get(id)
    if (current) {
      if (!current.evidence.includes(evidence)) current.evidence.push(evidence)
      current.confidence = confidence(current.evidence.length)
      return
    }
    services.set(id, { id, label, confidence: 'low', evidence: [evidence] })
  }

  for (const envKey of envKeys) {
    if (envKey.serviceId && envKey.serviceLabel) add(envKey.serviceId, envKey.serviceLabel, envKey.key)
  }

  for (const dep of deps) {
    for (const rule of SERVICE_RULES) {
      if (rule.dependencyPatterns?.some(pattern => pattern.test(dep))) {
        add(rule.id, rule.label, dep)
      }
    }
  }

  return [...services.values()]
    .map(service => ({ ...service, confidence: confidence(service.evidence.length) }))
    .sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 }
      return rank[b.confidence] - rank[a.confidence] || a.label.localeCompare(b.label)
    })
}

export async function scanProject(request: ProjectScanRequest): Promise<ProjectScanResult> {
  if (!request.path || !isAbsolute(request.path)) throw new Error('Project path must be absolute')
  const rootPath = resolve(request.path)
  const stat = await fs.lstat(rootPath).catch(() => null)
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Project path is not a regular folder')
  const canonicalRoot = await fs.realpath(rootPath)

  const collected = await collectProjectFiles(canonicalRoot)
  const requestedManualFiles = [...new Set((request.manualFiles ?? []).filter(Boolean).map(file => resolve(file)))]
  const manualFiles: string[] = []
  for (const manualFile of requestedManualFiles) {
    const stat = await fs.lstat(manualFile).catch(() => null)
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('Manual scan file is not a regular file')
    const canonicalFile = await fs.realpath(manualFile)
    if (!isPathInside(canonicalRoot, canonicalFile)) {
      throw new Error('Manual scan files must be contained in the selected project folder')
    }
    await assertNoSymlinkSegments(canonicalRoot, canonicalFile)
    manualFiles.push(canonicalFile)
  }
  const allFiles = [
    ...collected.files,
    ...manualFiles.map(path => ({ path, manual: true })),
  ].filter((file, index, arr) => arr.findIndex(other => other.path === file.path) === index)

  const prepared = await prepareScanFiles(allFiles)
  const reads = (await mapWithConcurrency(prepared.files, MAX_READ_CONCURRENCY, readScanFile))
    .filter((read): read is FileRead => Boolean(read))
  const { envKeys, envFiles } = extractEnvKeys(reads)
  const deps = dependencyNames(reads)
  const projectTypes = inferProjectTypes(reads, deps)
  const services = inferServices(envKeys, deps)

  return {
    rootPath: canonicalRoot,
    scannedAt: new Date().toISOString(),
    scannedFileCount: reads.length,
    skippedFileCount: collected.skipped + prepared.skipped + Math.max(0, prepared.files.length - reads.length),
    manualFiles,
    projectTypes,
    services,
    envFiles,
    envKeys,
    warnings: [...collected.warnings, ...prepared.warnings],
  }
}

export interface ProjectDiscoveryAuthorizationLease {
  assertCurrent(): Promise<void>
}

export interface ProjectDiscoveryAuthorization {
  acquireCandidateLease(path: string): Promise<ProjectDiscoveryAuthorizationLease>
}

export async function discoverProjectCandidates(
  request: ProjectDiscoverRequest,
  authorization?: ProjectDiscoveryAuthorization,
): Promise<ProjectDiscoverResult> {
  if (!request.parentPath || !isAbsolute(request.parentPath)) throw new Error('Parent path must be absolute')
  const parentPath = resolve(request.parentPath)
  const stat = await fs.lstat(parentPath).catch(() => null)
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Parent path is not a regular folder')
  const canonicalParent = await fs.realpath(parentPath)

  const warnings: string[] = []
  const candidates: ProjectScanCandidate[] = []
  const candidateLeases: ProjectDiscoveryAuthorizationLease[] = []
  const seen = new Set<string>()
  const roots = await discoverCandidateRoots(canonicalParent, warnings)

  for (const rootPath of roots.slice(0, MAX_DISCOVERY_CANDIDATES)) {
    if (seen.has(rootPath)) continue
    seen.add(rootPath)
    const lease = await authorization?.acquireCandidateLease(rootPath)
    let result: ProjectScanResult
    try {
      result = await scanProject({ path: rootPath })
    } catch {
      // A candidate can disappear or be unreadable between directory listing and
      // scan. Discovery should keep returning the usable projects it found.
      continue
    }
    await lease?.assertCurrent()
    if (!isInterestingProjectCandidate(result)) continue
    candidates.push(projectScanCandidate(result))
    if (lease) candidateLeases.push(lease)
    warnings.push(...result.warnings.map(warning => `${basename(rootPath)}: ${warning}`))
  }

  // A policy transition while later candidates were being inspected must
  // invalidate the whole discovery result, including earlier candidates.
  for (const lease of candidateLeases) await lease.assertCurrent()

  return {
    parentPath: canonicalParent,
    scannedAt: new Date().toISOString(),
    candidates: candidates
      .sort((a, b) => candidateScore(b) - candidateScore(a) || a.name.localeCompare(b.name))
      .slice(0, MAX_DISCOVERY_CANDIDATES),
    warnings,
  }
}

async function discoverCandidateRoots(parentPath: string, warnings: string[]): Promise<string[]> {
  const roots: string[] = []
  if (await hasProjectMarker(parentPath)) roots.push(parentPath)

  let entries: Dirent[]
  try {
    entries = await fs.readdir(parentPath, { withFileTypes: true })
  } catch {
    throw new Error('Could not read parent folder')
  }

  const childDirs = entries
    .filter(entry => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_DISCOVERY_DIRS)

  if (childDirs.length < entries.filter(entry => entry.isDirectory()).length) {
    warnings.push(`Checked the first ${MAX_DISCOVERY_DIRS} child folders to keep discovery fast.`)
  }

  for (const entry of childDirs) {
    const childPath = join(parentPath, entry.name)
    if (await hasProjectMarker(childPath)) roots.push(childPath)
  }

  return roots
}

async function hasProjectMarker(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.some(entry => {
    if (entry.isFile()) {
      return SCANNABLE_FILENAMES.has(entry.name) ||
        entry.name.startsWith('.env.') ||
        /^(package-lock|pnpm-lock|yarn)\.(json|yaml|lock)$/.test(entry.name)
    }
    if (entry.isDirectory()) return ['src', 'app', 'pages', 'public'].includes(entry.name)
    return false
  })
}

function isInterestingProjectCandidate(result: ProjectScanResult): boolean {
  return result.projectTypes.length > 0 ||
    result.envFiles.length > 0 ||
    result.envKeys.length > 0 ||
    result.services.length > 0
}

function projectScanCandidate(result: ProjectScanResult): ProjectScanCandidate {
  return {
    path: result.rootPath,
    name: basename(result.rootPath),
    envKeyCount: result.envKeys.length,
    envFileCount: result.envFiles.length,
    serviceCount: result.services.length,
    services: result.services.slice(0, 4).map(service => service.label),
    projectTypes: result.projectTypes.slice(0, 3).map(projectType => projectType.label),
    scannedFileCount: result.scannedFileCount,
    warningCount: result.warnings.length,
  }
}

function candidateScore(candidate: ProjectScanCandidate): number {
  return candidate.envFileCount * 8 +
    candidate.envKeyCount * 4 +
    candidate.serviceCount * 3 +
    candidate.projectTypes.length * 2 +
    Math.min(candidate.scannedFileCount, 20)
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
}

function formatByteLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const rel = relative(parentPath, candidatePath)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function assertNoSymlinkSegments(rootPath: string, candidatePath: string): Promise<void> {
  const rel = relative(rootPath, candidatePath)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Manual scan files must be contained in the selected project folder')
  }

  let current = rootPath
  for (const segment of rel.split(sep)) {
    current = join(current, segment)
    const stat = await fs.lstat(current).catch(() => null)
    if (!stat) throw new Error('Manual scan file is unavailable')
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in project scans')
  }
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await mapper(values[index])
    }
  })
  await Promise.all(workers)
  return results
}
