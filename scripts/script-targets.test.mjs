import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { validateLocalPackageTargets } from './script-targets.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('local package script targets', () => {
  it('validates the script path after Node test-runner options', () => {
    const root = fixture({ test: 'node --test --test-concurrency=1 scripts/missing.test.mjs' })

    expect(validateLocalPackageTargets(root)).toEqual([
      'script test references missing scripts/missing.test.mjs',
    ])
  })

  it('accepts an existing quoted script path after Node options with values', () => {
    const root = fixture({ test: 'node --test --test-reporter spec "scripts/target test.mjs"' }, [
      'scripts/target test.mjs',
    ])

    expect(validateLocalPackageTargets(root)).toEqual([])
  })

  it('validates local module paths supplied through Node preload and loader options', () => {
    const root = fixture({
      test: 'node --require ./scripts/missing-preload.mjs --import=./scripts/missing-import.mjs --test scripts/target.test.mjs',
    }, ['scripts/target.test.mjs'])

    expect(validateLocalPackageTargets(root)).toEqual([
      'script test references missing ./scripts/missing-preload.mjs',
      'script test references missing ./scripts/missing-import.mjs',
    ])
  })

  it('accepts existing quoted and inline Node module paths', () => {
    const root = fixture({
      test: 'node -r "./scripts/preload file.mjs" --experimental-loader=./scripts/loader.mjs --test scripts/target.test.mjs',
    }, [
      'scripts/preload file.mjs',
      'scripts/loader.mjs',
      'scripts/target.test.mjs',
    ])

    expect(validateLocalPackageTargets(root)).toEqual([])
  })

  it('validates other Node input paths without treating semantic values or package specifiers as files', () => {
    const root = fixture({
      test: 'node --conditions development --input-type module --loader tsx/esm --test-reporter spec --env-file .env scripts/target.test.mjs',
    }, ['scripts/target.test.mjs'])

    expect(validateLocalPackageTargets(root)).toEqual([
      'script test references missing .env',
    ])
  })

  it('accepts existing Node input files and directories', () => {
    const root = fixture({
      test: 'node --openssl-config ./config/openssl.cnf --icu-data-dir=./icu scripts/target.mjs',
    }, [
      'config/openssl.cnf',
      'scripts/target.mjs',
    ], ['icu'])

    expect(validateLocalPackageTargets(root)).toEqual([])
  })

  it('does not treat inline eval source as a local target', () => {
    const root = fixture({ inspect: 'node --eval "import(\'./missing.mjs\')"' })

    expect(validateLocalPackageTargets(root)).toEqual([])
  })
})

function fixture(scripts, files = [], directories = []) {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-script-targets-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ scripts })}\n`)
  for (const directory of directories) mkdirSync(join(root, directory), { recursive: true })
  for (const file of files) {
    const path = join(root, file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '')
  }
  return root
}
