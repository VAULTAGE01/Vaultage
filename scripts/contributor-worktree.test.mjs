import assert from 'node:assert/strict'
import test from 'node:test'
import { checkContributorState } from './contributor-worktree.mjs'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

function state(overrides = {}) {
  return {
    aheadCount: 0,
    branch: 'feature/example',
    head: SHA_A,
    phase: 'preflight',
    remoteUrls: [
      { embedsHttpCredentials: false, name: 'upstream', repository: 'VAULTAGE01/Vaultage' },
      { embedsHttpCredentials: false, name: 'origin', repository: 'contributor/Vaultage' },
    ],
    status: '',
    upstreamHead: SHA_A,
    upstreamIsAncestor: true,
    ...overrides,
  }
}

test('accepts a clean contributor branch at exact upstream main before work', () => {
  assert.deepEqual(checkContributorState(state()), [])
})

test('accepts a clean committed branch descending from upstream at finish', () => {
  assert.deepEqual(checkContributorState(state({
    aheadCount: 2,
    head: SHA_B,
    phase: 'finish',
  })), [])
})

test('rejects protected, detached, dirty, stale, tokenized, and forkless worktrees', () => {
  const failures = checkContributorState(state({
    branch: 'main',
    head: SHA_B,
    remoteUrls: [
      { embedsHttpCredentials: true, name: 'origin', repository: 'VAULTAGE01/Vaultage' },
    ],
    status: ' M README.md',
  }))
  assert.ok(failures.some(failure => failure.includes('main or master')))
  assert.ok(failures.some(failure => failure.includes('must be clean')))
  assert.ok(failures.some(failure => failure.includes('exact fetched upstream')))
  assert.ok(failures.some(failure => failure.includes('contributor-owned')))
  assert.ok(failures.some(failure => failure.includes('must not embed credentials')))

  assert.ok(checkContributorState(state({ branch: null })).some(
    failure => failure.includes('named branch'),
  ))
})

test('rejects a finish that does not contain committed work above upstream', () => {
  const failures = checkContributorState(state({
    aheadCount: 0,
    phase: 'finish',
    upstreamIsAncestor: false,
  }))
  assert.ok(failures.some(failure => failure.includes('descend from fetched upstream')))
  assert.ok(failures.some(failure => failure.includes('at least one committed change')))
})
