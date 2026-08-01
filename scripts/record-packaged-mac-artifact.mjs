#!/usr/bin/env node
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { digest, digestAppBundle } from './mac-artifact-digest-lib.mjs'

try {
  const values = parse(process.argv.slice(2))
  const dmg = boundedFile(values['--dmg'], 4 * 1024 * 1024 * 1024, 'DMG')
  const record = {
    schemaVersion: 1,
    kind: 'vaultage-packaged-mac-artifact-record-v1',
    appSha256: digestAppBundle(values['--app']),
    dmgName: basename(resolve(values['--dmg'])),
    dmgSha256: digest(dmg),
  }
  writeFileSync(resolve(values['--out']), `${JSON.stringify(record, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  process.stdout.write(`Packaged macOS artifact recorded: ${record.dmgSha256}\n`)
} catch (error) {
  process.stderr.write(
    `Packaged macOS artifact record rejected: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  )
  process.exit(1)
}

function parse(args) {
  const allowed = ['--app', '--dmg', '--out']
  const result = {}
  while (args.length) {
    const key = args.shift()
    const value = args.shift()
    if (!allowed.includes(key) || Object.hasOwn(result, key) || !value) {
      throw new Error('packaged artifact arguments are invalid')
    }
    result[key] = value
  }
  if (allowed.some(key => !result[key])) {
    throw new Error('packaged artifact arguments are incomplete')
  }
  return result
}

function boundedFile(value, maximum, label) {
  const path = resolve(value)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) {
    throw new Error(`${label} must be a bounded regular file`)
  }
  return readFileSync(path)
}
