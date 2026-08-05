import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROTECTED_BRANCHES = new Set(['main', 'master'])
const UPSTREAM_REPOSITORY = 'VAULTAGE01/Vaultage'

export function checkContributorState({
  aheadCount,
  branch,
  head,
  phase,
  remoteUrls,
  status,
  upstreamHead,
  upstreamIsAncestor,
}) {
  const failures = []

  if (phase !== 'preflight' && phase !== 'finish') {
    failures.push('phase must be preflight or finish')
  }
  if (!branch) failures.push('contributor work must use a named branch, not detached HEAD')
  if (PROTECTED_BRANCHES.has(branch)) failures.push('contributor work must not run directly on main or master')
  if (status !== '') failures.push('contributor worktree must be clean; preserve or commit existing work first')
  if (!/^[a-f0-9]{40}$/u.test(head ?? '')) failures.push('current HEAD is not a full Git commit')
  if (!/^[a-f0-9]{40}$/u.test(upstreamHead ?? '')) failures.push('upstream main is unavailable; fetch it before continuing')

  const upstreamRemotes = remoteUrls.filter(remote => remote.repository === UPSTREAM_REPOSITORY)
  const forkRemotes = remoteUrls.filter(remote => remote.repository?.endsWith('/Vaultage')
    && remote.repository !== UPSTREAM_REPOSITORY)
  if (upstreamRemotes.length !== 1) failures.push('configure exactly one VAULTAGE01/Vaultage upstream remote')
  if (forkRemotes.length !== 1) failures.push('configure exactly one contributor-owned Vaultage fork remote')
  if (remoteUrls.some(remote => remote.embedsHttpCredentials)) {
    failures.push('Git remote URLs must not embed credentials or access tokens')
  }

  if (phase === 'preflight' && head && upstreamHead && head !== upstreamHead) {
    failures.push('preflight branch must start at the exact fetched upstream main commit')
  }
  if (phase === 'finish') {
    if (!upstreamIsAncestor) failures.push('finished branch must descend from fetched upstream main')
    if (!Number.isSafeInteger(aheadCount) || aheadCount < 1) {
      failures.push('finished branch must contain at least one committed change above upstream main')
    }
  }

  return failures
}

export function inspectContributorWorktree(root = process.cwd(), phase = 'preflight') {
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  const head = git(root, ['rev-parse', 'HEAD'])
  const remotes = (git(root, ['remote']) ?? '').split('\n').filter(Boolean)
  const remoteUrls = remotes.flatMap(name => {
    const url = git(root, ['remote', 'get-url', name])
    return url ? [{
      embedsHttpCredentials: /^https?:\/\/[^/\s]+@/u.test(url),
      name,
      repository: githubRepository(url),
      url,
    }] : []
  })
  const upstreamRemote = remoteUrls.find(remote => remote.repository === UPSTREAM_REPOSITORY)
  const forkRemote = remoteUrls.find(remote => remote.repository?.endsWith('/Vaultage')
    && remote.repository !== UPSTREAM_REPOSITORY)
  const upstreamRef = upstreamRemote ? `refs/remotes/${upstreamRemote.name}/main` : null
  const upstreamHead = upstreamRef ? git(root, ['rev-parse', '--verify', upstreamRef]) : null
  const upstreamIsAncestor = upstreamRef
    ? gitStatus(root, ['merge-base', '--is-ancestor', upstreamRef, 'HEAD']) === 0
    : false
  const aheadText = upstreamRef ? git(root, ['rev-list', '--count', `${upstreamRef}..HEAD`]) : null
  const aheadCount = aheadText && /^[0-9]+$/u.test(aheadText) ? Number(aheadText) : null

  return {
    failures: checkContributorState({
      aheadCount,
      branch,
      head,
      phase,
      remoteUrls,
      status,
      upstreamHead,
      upstreamIsAncestor,
    }),
    summary: {
      ahead_count: aheadCount,
      branch,
      head,
      phase,
      fork_remote: forkRemote?.name ?? null,
      upstream_head: upstreamHead,
      upstream_remote: upstreamRemote?.name ?? null,
    },
  }
}

function githubRepository(url) {
  const match = url.match(/github\.com(?::|\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/u)
  return match?.[1] ?? null
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false })
  return result.status === 0 ? result.stdout.trim() : null
}

function gitStatus(root, args) {
  return spawnSync('git', args, { cwd: root, stdio: 'ignore', shell: false }).status
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntrypoint) {
  const phase = process.argv[2] ?? 'preflight'
  const result = inspectContributorWorktree(process.cwd(), phase)
  if (result.failures.length > 0) {
    console.error('Contributor worktree check failed:')
    for (const failure of result.failures) console.error(`  - ${failure}`)
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({ schema_version: 1, ok: true, ...result.summary }))
  }
}
