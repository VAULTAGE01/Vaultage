import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { findPrivatePreloadIpcChannelLeaks } from './open-source-config.mjs'

const EXPECTED_ENTRYPOINTS = Object.freeze(['index.js', 'menuPanel.js'])
const AUDITED_EXTERNALS = Object.freeze(new Set(['electron']))
const REQUIRED_MENU_PANEL_CHANNELS = Object.freeze([
  'menu-panel:status',
  'menu-panel:search',
  'menu-panel:copy',
  'menu-panel:reveal',
  'menu-panel:create',
  'menu-panel:action',
  'menu-panel:open-app',
  'menu-panel:close',
])

const FORBIDDEN_MENU_PANEL_CHANNELS = Object.freeze([
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
])

function parseArguments(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv
  let edition
  let outputRoot
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--edition') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--edition requires open or private')
      edition = value
      index += 1
      continue
    }
    if (argument === '--output-root') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--output-root requires a path')
      outputRoot = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument ${argument}`)
  }

  const resolvedEdition = edition || (process.env['VAULTAGE_OPEN_CORE'] === '1' ? 'open' : 'private')
  if (resolvedEdition !== 'open' && resolvedEdition !== 'private') {
    throw new Error(`--edition must be open or private, received ${resolvedEdition}`)
  }
  return {
    edition: resolvedEdition,
    outputRoot: resolve(outputRoot || join(process.cwd(), 'out', 'preload')),
  }
}

function collectEntries(root, directory = root, entries = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name)
    const path = relative(root, absolutePath).replaceAll(sep, '/')
    if (entry.isDirectory()) {
      entries.push({ kind: 'directory', path })
      collectEntries(root, absolutePath, entries)
    } else if (entry.isFile()) {
      entries.push({ kind: 'file', path })
    } else if (entry.isSymbolicLink()) {
      entries.push({ kind: 'symlink', path })
    } else {
      entries.push({ kind: 'other', path })
    }
  }
  return entries
}

function isInsideRoot(root, path) {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..')
}

function moduleEdges(source, filePath) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const edges = []
  const failures = []

  if (sourceFile.parseDiagnostics.length > 0) {
    failures.push(`${filePath} contains JavaScript syntax errors`)
    return { edges, failures }
  }

  const addSpecifier = (kind, node) => {
    if (ts.isStringLiteral(node)) {
      edges.push({ kind, specifier: node.text })
      return
    }
    failures.push(`${filePath} contains non-literal ${kind} module edge`)
  }

  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      addSpecifier('static import', node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      addSpecifier('export', node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addSpecifier('import-equals', node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length === 0) {
          failures.push(`${filePath} contains dynamic import without a module specifier`)
        } else {
          addSpecifier('dynamic import', node.arguments[0])
        }
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length !== 1) {
          failures.push(`${filePath} contains require with a non-literal module specifier`)
        } else {
          addSpecifier('require', node.arguments[0])
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)
  return { edges, failures }
}

function relativeEdgeFailure(root, entryPath, edge) {
  const dependencyPath = resolve(dirname(entryPath), edge.specifier)
  if (!isInsideRoot(root, dependencyPath)) {
    return `${entryPath} ${edge.kind} edge escapes output root: ${edge.specifier}`
  }
  return `${entryPath} contains relative ${edge.kind} edge: ${edge.specifier}`
}

function checkPreloadSurfaces({ edition, outputRoot }) {
  const failures = []
  if (!existsSync(outputRoot)) {
    failures.push(`preload output root is missing for ${edition} edition: ${outputRoot}`)
    return failures
  }

  const outputRootStat = lstatSync(outputRoot)
  if (outputRootStat.isSymbolicLink()) {
    failures.push(`preload output root must not be a symbolic link: ${outputRoot}`)
    return failures
  }
  if (!outputRootStat.isDirectory()) {
    failures.push(`preload output root must be a directory: ${outputRoot}`)
    return failures
  }

  const entries = collectEntries(outputRoot)
  for (const entry of entries.filter(entry => entry.kind === 'symlink')) {
    failures.push(`preload output path must not contain a symbolic link: ${entry.path}`)
  }
  if (failures.length > 0) return failures

  for (const entrypoint of EXPECTED_ENTRYPOINTS) {
    if (!entries.some(entry => entry.kind === 'file' && entry.path === entrypoint)) {
      failures.push(`missing preload entrypoint ${entrypoint}`)
    }
  }
  for (const entry of entries) {
    if (entry.kind !== 'file' || !EXPECTED_ENTRYPOINTS.includes(entry.path)) {
      failures.push(`unexpected preload output ${entry.kind}: ${entry.path}`)
    }
  }
  if (failures.length > 0) return failures

  const sources = new Map(EXPECTED_ENTRYPOINTS.map(entrypoint => {
    const path = join(outputRoot, entrypoint)
    return [entrypoint, { path, source: readFileSync(path, 'utf8') }]
  }))

  for (const { path, source } of sources.values()) {
    const moduleScan = moduleEdges(source, path)
    failures.push(...moduleScan.failures)
    for (const edge of moduleScan.edges) {
      if (edge.specifier.startsWith('.') || edge.specifier.startsWith('/')) {
        failures.push(relativeEdgeFailure(outputRoot, path, edge))
      } else if (!AUDITED_EXTERNALS.has(edge.specifier)) {
        failures.push(`${path} contains non-audited external ${edge.kind} dependency: ${edge.specifier}`)
      }
    }
  }

  const menuPanel = sources.get('menuPanel.js')
  if (menuPanel === undefined) throw new Error('menuPanel.js source was not loaded')
  for (const channel of REQUIRED_MENU_PANEL_CHANNELS) {
    if (!menuPanel.source.includes(channel)) {
      failures.push(`missing required menu-panel channel ${channel}`)
    }
  }
  for (const channel of FORBIDDEN_MENU_PANEL_CHANNELS) {
    if (menuPanel.source.includes(channel)) {
      failures.push(`contains forbidden menu-panel channel ${channel}`)
    }
  }
  for (const channel of findPrivatePreloadIpcChannelLeaks(menuPanel.source)) {
    failures.push(`contains forbidden private IPC channel ${channel}`)
  }
  if (edition === 'open') {
    const index = sources.get('index.js')
    if (index === undefined) throw new Error('index.js source was not loaded')
    for (const channel of findPrivatePreloadIpcChannelLeaks(index.source)) {
      failures.push(`contains forbidden private IPC channel in open index: ${channel}`)
    }
  }
  return failures
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const failures = checkPreloadSurfaces(options)
  if (failures.length > 0) {
    console.error(`Preload surface boundary check failed for ${options.edition} edition:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`Preload surface boundary check passed for ${options.edition} edition: ${options.outputRoot}`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown checker failure'
  console.error(`Preload surface boundary check failed: ${message}`)
  process.exitCode = 1
}
