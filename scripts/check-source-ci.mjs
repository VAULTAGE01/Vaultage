import { readFileSync, readdirSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const PRIVATE_REPOSITORY = 'VAULTAGE01/vaultage-private'
const COMMUNITY_REPOSITORY = 'VAULTAGE01/Vaultage'
const PRIVATE_WORKFLOWS = [
  'ci.yml',
  'extension-store-publish.yml',
  'extension-store-upload.yml',
  'release.yml',
]
const COMMUNITY_WORKFLOWS = ['ci.yml']

export function privateSourceCiWorkflow() {
  return `name: CI

on:
  push:
    branches:
      - main
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  portable-release-gates:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false

      - name: Verify source-CI policy before dependency execution
        run: node scripts/check-source-ci.mjs

      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271
        with:
          version: 11.11.0

      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Linear roadmap integrity tests
        run: pnpm test:linear-roadmap

      - name: Release gates
        run: pnpm verify:release:portable

  open-source-gates:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false

      - name: Verify source-CI policy before dependency execution
        run: node scripts/check-source-ci.mjs

      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271
        with:
          version: 11.11.0

      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Verify public Vault + Projects source drop
        run: pnpm verify:open-source-stage
`
}

export function communitySourceCiWorkflow() {
  return `name: CI

on:
  push:
    branches:
      - main
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  community-release-gate:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
        with:
          persist-credentials: false

      - name: Verify source-CI policy before dependency execution
        run: node scripts/check-source-ci.mjs

      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271
        with:
          version: 11.11.0

      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Verify Community source
        run: pnpm verify:release
`
}

export function checkSourceCi(root = process.cwd(), env = process.env) {
  const failures = []
  let pkg
  try {
    pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  } catch {
    return ['source-CI policy could not read package identity']
  }

  const community = pkg.name === 'vaultage-open-local'
  if (!community && pkg.name !== 'vaultage') {
    failures.push('source-CI package identity is not canonical')
  }
  const repository = community ? COMMUNITY_REPOSITORY : PRIVATE_REPOSITORY
  const expectedWorkflow = community ? communitySourceCiWorkflow() : privateSourceCiWorkflow()
  const expectedWorkflowFiles = community ? COMMUNITY_WORKFLOWS : PRIVATE_WORKFLOWS

  let workflowFiles = []
  try {
    workflowFiles = readdirSync(resolve(root, '.github/workflows'), { withFileTypes: true })
      .map(entry => entry.isFile() ? entry.name : `${entry.name}/`)
      .sort()
  } catch {
    failures.push('source-CI workflow inventory is unreadable')
  }
  if (!sameArray(workflowFiles, expectedWorkflowFiles)) {
    failures.push(`source-CI workflow inventory must be exactly: ${expectedWorkflowFiles.join(', ')}`)
  }

  let actualWorkflow = ''
  try {
    actualWorkflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
  } catch {
    failures.push('source-CI workflow is unreadable')
  }
  if (actualWorkflow !== expectedWorkflow) {
    failures.push('source-CI workflow bytes do not match the reviewed canonical inventory')
  }

  if (env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true') {
    failures.push('source-CI guard runs only in GitHub Actions CI')
  }
  if (env.GITHUB_REPOSITORY !== repository) {
    failures.push(`source-CI repository must be ${repository}`)
  }

  const head = git(root, ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '') || env.GITHUB_SHA !== head) {
    failures.push('source-CI checkout must equal the exact GitHub event SHA')
  }
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    if (!/^refs\/pull\/[1-9][0-9]*\/merge$/u.test(env.GITHUB_REF ?? '')) {
      failures.push('source-CI pull request must use GitHub synthetic merge ref')
    }
  } else if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    failures.push('source-CI event must be a pull request merge ref or main push')
  }

  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status === null || status !== '') failures.push('source-CI checkout must be clean')
  return failures
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false })
  return result.status === 0 ? result.stdout.trim() : null
}

function sameArray(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntrypoint) {
  const failures = checkSourceCi()
  if (failures.length > 0) {
    console.error('Source-CI guard failed:')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({
      schema_version: 1,
      repository: process.env.GITHUB_REPOSITORY,
      event: process.env.GITHUB_EVENT_NAME,
      git_sha: process.env.GITHUB_SHA,
      exact: true,
    }))
  }
}
