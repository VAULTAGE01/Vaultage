import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import {
  isPrivateOverlaySourcePath,
  openNodeAliasPaths,
  openNodeTypecheckExclude,
  openNodeTypecheckInclude,
  openWebAliasPaths,
  openWebTypecheckExclude,
  openWebTypecheckInclude,
  stripClosedReleaseConfiguration,
} from './open-source-config.mjs'

const root = process.cwd()
const cacheRoot = join(root, 'node_modules', '.cache')
mkdirSync(cacheRoot, { recursive: true })
const tmp = mkdtempSync(join(cacheRoot, 'vaultage-open-types-'))
const stagedViteConfigPath = join(tmp, 'electron.vite.config.open.ts')
const stagedViteConfigDirectory = dirname(stagedViteConfigPath)
const stagedViteConfig = stripClosedReleaseConfiguration(
  readFileSync(join(root, 'electron.vite.config.ts'), 'utf8'),
).replace(
  /from '(\.\/[^']+)'/gu,
  (_match, specifier) => {
    const absoluteTarget = resolve(root, specifier)
    const relocatedTarget = relative(stagedViteConfigDirectory, absoluteTarget)
      .split('\\')
      .join('/')
    return `from '${relocatedTarget.startsWith('.') ? relocatedTarget : `./${relocatedTarget}`}'`
  },
)
writeFileSync(
  stagedViteConfigPath,
  stagedViteConfig,
)

function filesBelow(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) filesBelow(path, files)
    else if (entry.isFile()) files.push(relative(root, path).split('\\').join('/'))
  }
  return files
}

const privateOverlayExcludes = filesBelow(join(root, 'src')).filter(isPrivateOverlaySourcePath)

const webPaths = {
  '@renderer/*': ['src/renderer/src/*'],
  '@/*': ['src/renderer/src/*'],
  ...openWebAliasPaths,
}

function toRootPaths(paths) {
  return paths.map(path => resolve(root, path))
}

function writeConfig(name, baseConfig, paths, include, exclude) {
  const path = join(tmp, name)
  writeFileSync(path, `${JSON.stringify({
    extends: resolve(root, baseConfig),
    include: toRootPaths(include),
    exclude: toRootPaths(exclude),
    compilerOptions: { paths },
  }, null, 2)}\n`)
  return path
}

function runTsc(configPath) {
  const result = spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', configPath], {
    cwd: root,
    env: { ...process.env, VAULTAGE_OPEN_CORE: '1' },
    stdio: 'inherit',
    shell: false,
  })
  return result.status ?? 1
}

try {
  const nodeStatus = runTsc(writeConfig(
    'tsconfig.node.open.json',
    'tsconfig.node.json',
    openNodeAliasPaths,
    [
      ...openNodeTypecheckInclude.filter(path => !path.startsWith('electron.vite.config.')),
      stagedViteConfigPath,
    ],
    [...openNodeTypecheckExclude, ...privateOverlayExcludes],
  ))
  if (nodeStatus !== 0) process.exit(nodeStatus)

  const webStatus = runTsc(writeConfig(
    'tsconfig.web.open.json',
    'tsconfig.web.json',
    webPaths,
    openWebTypecheckInclude,
    [...openWebTypecheckExclude, ...privateOverlayExcludes],
  ))
  if (webStatus !== 0) process.exit(webStatus)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log('Open alias type checks passed.')
