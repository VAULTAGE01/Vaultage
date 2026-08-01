#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

try {
  const { directory, recordPath, acceptancePath } = parse(process.argv.slice(2))
  const root = resolve(directory)
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('DMG directory must be a real directory')
  }
  const candidates = readdirSync(root)
    .filter(name => name.endsWith('.dmg'))
    .sort()
    .map(name => join(root, name))
  if (candidates.length !== 1) {
    throw new Error(`release directory must contain exactly one regular DMG; found ${candidates.length}`)
  }
  const candidateStat = lstatSync(candidates[0])
  if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
    throw new Error('release DMG must be a regular non-symlink file')
  }
  if (recordPath) {
    const record = JSON.parse(readFileSync(resolve(recordPath), 'utf8'))
    const keys = Object.keys(record).sort().join(',')
    if (
      keys !== ['appSha256', 'dmgName', 'dmgSha256', 'kind', 'schemaVersion'].sort().join(',')
      || record.schemaVersion !== 1
      || record.kind !== 'vaultage-packaged-mac-artifact-record-v1'
      || record.dmgName !== basename(candidates[0])
    ) {
      throw new Error('release DMG does not match the exact build-stage artifact name')
    }
  }
  if (acceptancePath) {
    const receipt = JSON.parse(readFileSync(resolve(acceptancePath), 'utf8'))
    const actualDigest = createHash('sha256').update(readFileSync(candidates[0])).digest('hex')
    if (
      receipt?.schemaVersion !== 1
      || receipt?.kind !== 'vaultage-downloaded-mac-artifact-acceptance-v1'
      || receipt.dmgName !== basename(candidates[0])
      || receipt.dmgSha256 !== actualDigest
    ) {
      throw new Error('release DMG does not match the downloaded acceptance receipt')
    }
  }
  process.stdout.write(`${candidates[0]}\n`)
} catch (error) {
  process.stderr.write(
    `Release DMG selection rejected: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  )
  process.exit(1)
}

function parse(args) {
  if (![1, 3, 5].includes(args.length)) {
    throw new Error(
      'usage: select-exact-release-dmg.mjs <directory> [--artifact-record <path>] [--acceptance-receipt <path>]',
    )
  }
  const directory = args.shift()
  const result = { directory }
  while (args.length) {
    const key = args.shift()
    const value = args.shift()
    if (
      !value
      || (key !== '--artifact-record' && key !== '--acceptance-receipt')
      || (key === '--artifact-record' && result.recordPath)
      || (key === '--acceptance-receipt' && result.acceptancePath)
    ) {
      throw new Error('release DMG selection arguments are invalid')
    }
    if (key === '--artifact-record') result.recordPath = value
    else result.acceptancePath = value
  }
  return result
}
