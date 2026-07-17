import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { communitySourceCiWorkflow, privateSourceCiWorkflow } from './check-source-ci.mjs'

const checker = resolve(dirname(fileURLToPath(import.meta.url)), 'check-source-ci.mjs')
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('dependency-free source-CI guard', () => {
  it.each([
    ['private main push', false, 'push', 'refs/heads/main'],
    ['Community pull-request merge', true, 'pull_request', 'refs/pull/42/merge'],
  ])('accepts the exact %s checkout before dependency setup', (_label, community, event, ref) => {
    const fixture = fixtureRoot({ community })
    const result = check(fixture, { event, ref })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ exact: true, git_sha: fixture.sha })
  })

  it.each([
    ['wrong repository', { repository: 'attacker/vaultage-private' }, 'repository must be'],
    ['wrong SHA', { sha: 'a'.repeat(40) }, 'exact GitHub event SHA'],
    ['non-synthetic PR ref', { event: 'pull_request', ref: 'refs/heads/feature' }, 'synthetic merge ref'],
    ['non-main push', { event: 'push', ref: 'refs/heads/develop' }, 'pull request merge ref or main push'],
  ])('rejects %s', (_label, overrides, error) => {
    const fixture = fixtureRoot({ community: false })
    const result = check(fixture, overrides)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(error)
  })

  it('rejects workflow-byte drift and unexpected workflow files', () => {
    const fixture = fixtureRoot({ community: false })
    write(fixture.root, '.github/workflows/ci.yml', `${privateSourceCiWorkflow()}# bypass\n`)
    write(fixture.root, '.github/workflows/hidden.yml', 'jobs: {}\n')

    const result = check(fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('workflow inventory must be exactly')
    expect(result.stderr).toContain('workflow bytes do not match')
    expect(result.stderr).toContain('checkout must be clean')
  })
})

function fixtureRoot({ community }) {
  const root = mkdtempSync(join(tmpdir(), 'vaultage-source-ci-'))
  roots.push(root)
  write(root, 'package.json', `${JSON.stringify({ name: community ? 'vaultage-open-local' : 'vaultage' })}\n`)
  write(root, '.github/workflows/ci.yml', community ? communitySourceCiWorkflow() : privateSourceCiWorkflow())
  if (!community) {
    for (const workflow of ['extension-store-publish.yml', 'extension-store-upload.yml', 'release.yml']) {
      write(root, `.github/workflows/${workflow}`, 'name: protected operator\n')
    }
  }
  git(root, ['init', '--quiet'])
  git(root, ['add', '.'])
  git(root, ['-c', 'user.name=Vaultage Test', '-c', 'user.email=test@localhost', 'commit', '--quiet', '-m', 'fixture'])
  return { root, sha: git(root, ['rev-parse', 'HEAD']).stdout.trim(), community }
}

function check(fixture, overrides = {}) {
  return spawnSync(process.execPath, [checker], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: overrides.repository
        ?? (fixture.community ? 'VAULTAGE01/Vaultage' : 'VAULTAGE01/vaultage-private'),
      GITHUB_SHA: overrides.sha ?? fixture.sha,
      GITHUB_EVENT_NAME: overrides.event ?? 'push',
      GITHUB_REF: overrides.ref ?? 'refs/heads/main',
    },
  })
}

function write(root, path, value) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, value)
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false })
  if (result.status !== 0) throw new Error(result.stderr)
  return result
}
