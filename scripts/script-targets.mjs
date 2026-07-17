import { existsSync, readFileSync, statSync } from 'fs'
import { resolve, sep } from 'path'

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function isLocalPath(value) {
  return (
    value &&
    !value.startsWith('-') &&
    !value.startsWith('$') &&
    !value.includes('://') &&
    (value.includes('/') || /\.(?:[cm]?[jt]s|sh)$/.test(value))
  )
}

const nodeInlineScriptOptions = new Set(['-e', '--eval', '-p', '--print'])
const nodeInputPathOptions = new Map([
  ['-r', { expected: 'file', kind: 'module' }],
  ['--require', { expected: 'file', kind: 'module' }],
  ['--import', { expected: 'file', kind: 'module' }],
  ['--loader', { expected: 'file', kind: 'module' }],
  ['--experimental-loader', { expected: 'file', kind: 'module' }],
  ['--env-file', { expected: 'file', kind: 'path' }],
  ['--icu-data-dir', { expected: 'directory', kind: 'path' }],
  ['--openssl-config', { expected: 'file', kind: 'path' }],
])
const nodeOptionsWithValues = new Set([
  '-r',
  '--conditions',
  '--diagnostic-dir',
  '--env-file',
  '--experimental-loader',
  '--heap-prof-dir',
  '--icu-data-dir',
  '--import',
  '--input-type',
  '--loader',
  '--openssl-config',
  '--redirect-warnings',
  '--require',
  '--test-concurrency',
  '--test-name-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-shard',
  '--test-skip-pattern',
  '--title',
])

function commandTokens(value) {
  return [...value.matchAll(/"[^"]*"|'[^']*'|[^\s]+/g)].map(match => unquote(match[0]))
}

function isLocalOptionPath(value, kind) {
  if (
    !value ||
    value.startsWith('-') ||
    value.startsWith('$') ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
  ) return false

  if (kind === 'module') {
    return value.startsWith('./') || value.startsWith('../') || value.startsWith('/')
  }
  return true
}

function nodeOption(token) {
  const equalsAt = token.indexOf('=')
  if (equalsAt > 0) {
    return { name: token.slice(0, equalsAt), inlineValue: token.slice(equalsAt + 1) }
  }
  if (token.startsWith('-r') && !token.startsWith('--') && token.length > 2) {
    return { name: '-r', inlineValue: token.slice(2) }
  }
  return { name: token, inlineValue: null }
}

function runnerTargets(runner, argumentText) {
  const tokens = commandTokens(argumentText)
  const targets = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--') {
      if (tokens[index + 1]) targets.push({ candidate: tokens[index + 1], expected: 'file' })
      break
    }

    if (runner === 'node' && nodeInlineScriptOptions.has(token)) break
    if (runner !== 'node' && token === '-c') break

    if (runner === 'node') {
      const option = nodeOption(token)
      const pathOption = nodeInputPathOptions.get(option.name)
      if (pathOption) {
        const value = option.inlineValue ?? tokens[index + 1] ?? null
        if (option.inlineValue === null) index += 1
        if (isLocalOptionPath(value, pathOption.kind)) {
          targets.push({ candidate: value, expected: pathOption.expected, fromOption: true })
        }
        continue
      }
      if (option.inlineValue === null && nodeOptionsWithValues.has(option.name)) {
        index += 1
        continue
      }
    }
    if (token.startsWith('-')) continue
    targets.push({ candidate: token, expected: 'file', fromOption: false })
    break
  }
  return targets
}

export function validateLocalPackageTargets(root) {
  const failures = []
  const packagePath = resolve(root, 'package.json')
  if (!existsSync(packagePath)) return ['package.json is missing']

  let pkg
  try {
    pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch (error) {
    return [`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
  }

  const checkPath = (label, candidate, expected = 'file') => {
    const target = resolve(root, unquote(candidate))
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      failures.push(`${label} escapes the package root: ${candidate}`)
      return
    }
    if (!existsSync(target)) {
      failures.push(`${label} references missing ${candidate}`)
      return
    }
    const stat = statSync(target)
    if (expected === 'file' && !stat.isFile()) failures.push(`${label} expects a file at ${candidate}`)
    if (expected === 'directory' && !stat.isDirectory()) failures.push(`${label} expects a directory at ${candidate}`)
  }

  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (typeof command !== 'string') {
      failures.push(`script ${name} must be a string`)
      continue
    }

    const runnerPattern = /(?:^|&&|\|\||;)\s*(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)*(node|bash|sh)\s+((?:"[^"]*"|'[^']*'|[^\s;&|]+)(?:\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+))*)/g
    for (const match of command.matchAll(runnerPattern)) {
      for (const { candidate, expected, fromOption } of runnerTargets(match[1], match[2])) {
        if (fromOption || isLocalPath(candidate)) {
          checkPath(`script ${name}`, candidate, expected)
        }
      }
    }

    const prefixPattern = /\b(?:npm|pnpm)\s+--prefix\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g
    for (const match of command.matchAll(prefixPattern)) {
      const directory = unquote(match[1])
      checkPath(`script ${name}`, directory, 'directory')
      if (existsSync(resolve(root, directory))) checkPath(`script ${name}`, `${directory}/package.json`)
    }
  }

  for (const [name, target] of Object.entries(pkg.bin ?? {})) {
    if (typeof target !== 'string') failures.push(`bin ${name} must be a path string`)
    else checkPath(`bin ${name}`, target)
  }

  return failures
}
