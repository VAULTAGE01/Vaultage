import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { platform } from 'node:process'

const PROJECT_ROOT = realpathSync(resolve(import.meta.dirname, '..'))
const OUTPUT_ROOT = resolve(PROJECT_ROOT, 'out')
const REQUIRED_OUTPUTS = Object.freeze([
  'main/index.js',
  'preload/index.js',
  'preload/menuPanel.js',
  'renderer/index.html',
])

export function assertDarwinPlatform(candidate) {
  if (candidate !== 'darwin') {
    throw new Error('Community UI E2E requires a Darwin runner.')
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function collectOutputFiles(root, directory = root, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink()) {
      throw new Error(`Community build output contains a symbolic link: ${relative(root, path)}`)
    }
    if (entry.isDirectory()) {
      collectOutputFiles(root, path, files)
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Community build output contains a non-file entry: ${relative(root, path)}`)
    }
    files.push({
      path: relative(root, path).split(sep).join('/'),
      mode: metadata.mode & 0o777,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      sha256: sha256(readFileSync(path)),
    })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function digestFiles(files) {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(`${file.path}\0${file.mode}\0${file.size}\0${file.sha256}\0`)
  }
  return hash.digest('hex')
}

function createBuildManifest(buildStartedAtMs) {
  if (!existsSync(OUTPUT_ROOT)) throw new Error('Fresh Community build did not create out/.')
  const outputRoot = realpathSync(OUTPUT_ROOT)
  const files = collectOutputFiles(outputRoot)
  for (const required of REQUIRED_OUTPUTS) {
    if (!files.some(file => file.path === required)) {
      throw new Error(`Fresh Community build is missing ${required}.`)
    }
  }
  const stale = files.find(file => file.mtimeMs + 1_000 < buildStartedAtMs)
  if (stale !== undefined) {
    throw new Error(`Community build output predates the build start: ${stale.path}`)
  }
  return {
    version: 1,
    sourceRoot: PROJECT_ROOT,
    outputRoot,
    buildStartedAtMs,
    manifestCreatedAtMs: Date.now(),
    fileCount: files.length,
    outputSha256: digestFiles(files),
    files,
  }
}

function readFreshBuildManifest(manifestPath, notBeforeMs) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Community build manifest must be an object.')
  }
  if (typeof parsed.buildStartedAtMs !== 'number' || parsed.buildStartedAtMs < notBeforeMs) {
    throw new Error('Community build manifest must be created after the runner start.')
  }
  if (parsed.version !== 1
    || parsed.sourceRoot !== PROJECT_ROOT
    || parsed.outputRoot !== realpathSync(OUTPUT_ROOT)
    || typeof parsed.manifestCreatedAtMs !== 'number'
    || parsed.manifestCreatedAtMs < parsed.buildStartedAtMs
    || typeof parsed.outputSha256 !== 'string'
    || !Array.isArray(parsed.files)) {
    throw new Error('Community build manifest has an invalid shape or root identity.')
  }
  const currentFiles = collectOutputFiles(parsed.outputRoot)
  if (currentFiles.length !== parsed.fileCount || digestFiles(currentFiles) !== parsed.outputSha256) {
    throw new Error('Community build output does not match the fresh manifest.')
  }
  return parsed
}

function parseArguments(argv) {
  const filtered = argv.filter(argument => argument !== '--')
  if (filtered[0] === '--check-platform') {
    if (filtered.length !== 2) throw new Error('usage: --check-platform <platform>')
    return { mode: 'check-platform', candidate: filtered[1] }
  }
  if (filtered[0] === '--built-only') {
    if (filtered.length !== 2) throw new Error('usage: --built-only <manifest>')
    return { mode: 'built-only', manifestPath: resolve(filtered[1]) }
  }
  if (filtered.length === 0) return { mode: 'run', scenarios: null }
  if (filtered.length === 2 && filtered[0] === '--scenario' && /^[a-z0-9,-]+$/u.test(filtered[1])) {
    return { mode: 'run', scenarios: filtered[1] }
  }
  throw new Error('usage: node scripts/community-ui-e2e.mjs [--scenario <comma-separated-names>]')
}

function runCommand(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: environment,
    shell: false,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status ?? 1}`)
  }
}

function runCommunityE2E(options, runnerStartedAtMs) {
  assertDarwinPlatform(platform)
  const runRoot = mkdtempSync(join(realpathSync(tmpdir()), 'vaultage-community-ui-e2e-run-'))
  const appRoot = join(runRoot, 'apps')
  mkdirSync(appRoot, { mode: 0o700 })
  try {
    const buildStartedAtMs = Date.now()
    console.log(JSON.stringify({
      event: 'community-ui-e2e.build-start',
      buildStartedAt: new Date(buildStartedAtMs).toISOString(),
    }))
    runCommand('pnpm', ['build:open-local'])
    const manifest = createBuildManifest(buildStartedAtMs)
    const manifestPath = join(runRoot, 'build-manifest.json')
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    readFreshBuildManifest(manifestPath, runnerStartedAtMs)
    console.log(JSON.stringify({
      event: 'community-ui-e2e.build-manifest',
      fileCount: manifest.fileCount,
      outputSha256: manifest.outputSha256,
    }))

    const environment = {
      ...process.env,
      VAULTAGE_OPEN_CORE: '1',
      VAULTAGE_COMMUNITY_E2E_BUILD_MANIFEST: manifestPath,
      VAULTAGE_COMMUNITY_E2E_EXPECTED_APP_ROOT: appRoot,
      VAULTAGE_COMMUNITY_E2E_EXPECTED_SOURCE_ROOT: PROJECT_ROOT,
    }
    if (options.scenarios !== null) {
      environment.VAULTAGE_COMMUNITY_E2E_SCENARIOS = options.scenarios
    }
    runCommand('pnpm', [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.community-e2e.config.ts',
    ], environment)
  } finally {
    rmSync(runRoot, { recursive: true, force: true })
  }
}

function main() {
  const runnerStartedAtMs = Date.now()
  const options = parseArguments(process.argv.slice(2))
  if (options.mode === 'check-platform') {
    assertDarwinPlatform(options.candidate)
    return
  }
  if (options.mode === 'built-only') {
    readFreshBuildManifest(options.manifestPath, runnerStartedAtMs)
    assertDarwinPlatform(platform)
    throw new Error('Built-only mode is reserved for an in-process fresh-build handoff.')
  }
  runCommunityE2E(options, runnerStartedAtMs)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Community UI E2E runner failed.')
  process.exitCode = 1
}
