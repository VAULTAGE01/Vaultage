import { promises as fs } from 'fs'
import type { Dirent } from 'fs'
import { basename, extname, isAbsolute, join, resolve } from 'path'
import type {
  ProjectScanEnvFile,
  ProjectScanEnvKey,
  ProjectScanFileRef,
  ProjectScanProjectType,
  ProjectScanRequest,
  ProjectScanResult,
  ProjectScanService,
} from '../shared/projectScan'

const MAX_SCAN_FILES = 1_200
const MAX_FILE_BYTES = 512 * 1024
const MAX_MANUAL_FILE_BYTES = 1024 * 1024
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
  if (/prod|production/.test(name)) return 'production'
  if (/stag|stage/.test(name)) return 'staging'
  if (/dev|development|local/.test(name)) return 'development'
  if (/test|testing/.test(name)) return 'testing'
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
    .replace(/(['"`])[^'"`]{12,}\1/g, '$1[redacted]$1')
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

async function readScanFile(file: ScanFile): Promise<FileRead | null> {
  const stat = await fs.stat(file.path).catch(() => null)
  if (!stat?.isFile()) return null
  const maxBytes = file.manual ? MAX_MANUAL_FILE_BYTES : MAX_FILE_BYTES
  if (stat.size > maxBytes) return null
  const buffer = await fs.readFile(file.path).catch(() => null)
  if (!buffer) return null
  if (buffer.includes(0)) return null
  return { file, text: buffer.toString('utf8') }
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

function parseDotenvValue(raw: string): string {
  let value = raw.trim()
  const hashIndex = value.search(/\s+#/)
  if (hashIndex >= 0) value = value.slice(0, hashIndex).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value.replace(/\\n/g, '\n').slice(0, MAX_ENV_VALUE_CHARS)
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
    let envFileKeyCount = 0

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const lineNumber = index + 1
      const dotenvMatch = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)

      if (dotenvMatch && isEnvFile(filePath)) {
        const key = normalizeKey(dotenvMatch[1].toUpperCase())
        if (!key) continue
        const envKey = get(key)
        envFileKeyCount += 1
        envKey.environment = envKey.environment ?? fileEnvironment
        addSource(envKey, {
          path: filePath,
          line: lineNumber,
          kind: 'env-file',
          excerpt: `${key}= [redacted]`,
          manual: read.file.manual,
        })
        const value = parseDotenvValue(dotenvMatch[2] ?? '')
        if (value) {
          envKey.values.push({
            value,
            sourceFile: filePath,
            line: lineNumber,
            environment: fileEnvironment,
            manual: read.file.manual,
          })
        }
        continue
      }

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

    if (isEnvFile(filePath)) {
      envFiles.push({
        path: filePath,
        environment: fileEnvironment,
        keyCount: envFileKeyCount,
        manual: read.file.manual,
      })
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
  const stat = await fs.stat(rootPath).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('Project path is not a folder')

  const collected = await collectProjectFiles(rootPath)
  const manualFiles = [...new Set((request.manualFiles ?? []).filter(Boolean).map(file => resolve(file)))]
  const allFiles = [
    ...collected.files,
    ...manualFiles.map(path => ({ path, manual: true })),
  ].filter((file, index, arr) => arr.findIndex(other => other.path === file.path) === index)

  const reads = (await Promise.all(allFiles.map(readScanFile))).filter((read): read is FileRead => Boolean(read))
  const { envKeys, envFiles } = extractEnvKeys(reads)
  const deps = dependencyNames(reads)
  const projectTypes = inferProjectTypes(reads, deps)
  const services = inferServices(envKeys, deps)

  return {
    rootPath,
    scannedAt: new Date().toISOString(),
    scannedFileCount: reads.length,
    skippedFileCount: collected.skipped + Math.max(0, allFiles.length - reads.length),
    manualFiles,
    projectTypes,
    services,
    envFiles,
    envKeys,
    warnings: collected.warnings,
  }
}
