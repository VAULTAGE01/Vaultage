import { expect, it } from 'vitest'
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

it('accepts a clean contributor branch at exact upstream main before work', () => {
  expect(checkContributorState(state())).toEqual([])
})

it('accepts a clean committed branch descending from upstream at finish', () => {
  expect(checkContributorState(state({
    aheadCount: 2,
    head: SHA_B,
    phase: 'finish',
  }))).toEqual([])
})

it('rejects protected, detached, dirty, stale, tokenized, and forkless worktrees', () => {
  const failures = checkContributorState(state({
    branch: 'main',
    head: SHA_B,
    remoteUrls: [
      { embedsHttpCredentials: true, name: 'origin', repository: 'VAULTAGE01/Vaultage' },
    ],
    status: ' M README.md',
  }))
  expect(failures.some(failure => failure.includes('main or master'))).toBe(true)
  expect(failures.some(failure => failure.includes('must be clean'))).toBe(true)
  expect(failures.some(failure => failure.includes('exact fetched upstream'))).toBe(true)
  expect(failures.some(failure => failure.includes('contributor-owned'))).toBe(true)
  expect(failures.some(failure => failure.includes('must not embed credentials'))).toBe(true)

  expect(checkContributorState(state({ branch: null })).some(
    failure => failure.includes('named branch'))).toBe(true)
})

it('rejects a finish that does not contain committed work above upstream', () => {
  const failures = checkContributorState(state({
    aheadCount: 0,
    phase: 'finish',
    upstreamIsAncestor: false,
  }))
  expect(failures.some(failure => failure.includes('descend from fetched upstream'))).toBe(true)
  expect(failures.some(failure => failure.includes('at least one committed change'))).toBe(true)
})
