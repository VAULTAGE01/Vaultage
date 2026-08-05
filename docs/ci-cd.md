# Vaultage Community CI

Status: public Community source protocol.

This is the canonical delivery and repository-housekeeping policy for humans,
Codex-based agents, Claude-based agents, and other automation. `AGENTS.md`
and `CLAUDE.md` point here.

## Branches

- `main`: release-candidate branch. Must stay green.
- Feature branches: short-lived branches merged by pull request.

Protect `main` so pull requests require the `community-release-gate` job.
During pre-release development, ordinary UI, refactor, and bug-fix pull
requests may be merged by their automation author after required PR CI passes,
followed by confirmation that the post-merge `main` SHA is green. A generated
sync is ordinary only when its originating private change was Lightweight or
Focused, its exact private provenance and staged digest are verified, and
neither source rules nor the generated diff changes a trust boundary. Security,
ambiguous generated sync, source-boundary, and release/publication changes
require an independent or maintainer review.

## External Contributor Worktrees

External contributors and contribution agents use a GitHub account and fork
that are distinct from the `VAULTAGE01` owner. Their local checkout has one
remote for `VAULTAGE01/Vaultage` and one remote for the contributor fork; HTTPS
remote URLs must never embed credentials.

Every task starts from a freshly fetched exact upstream `main` in a new named
branch and a dedicated clean worktree. Contributors run
`pnpm contributor:preflight` before editing. The command rejects protected or
detached branches, dirty or stale worktrees, missing fork/upstream separation,
and token-bearing remote URLs. After committing, `pnpm contributor:finish`
requires a clean branch containing at least one commit descended from upstream
`main` and reports the verified fork remote name. Push only to that remote;
do not assume a shared checkout's `origin` is the fork.

Contributors push only to their fork and open a pull request into upstream
`main`. They do not switch to a maintainer GitHub identity, reuse a maintainer's
dirty checkout, push directly to upstream, or bypass the required Ubuntu PR CI.
Maintainers reconcile accepted public Vault/Projects changes into the canonical
private composition separately; that import must preserve public authorship and
source provenance.

## Pull Request CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
Its dependency-free first repository step checks `VAULTAGE01/Vaultage`,
GitHub's synthetic pull-request merge SHA or exact `main` push SHA, a clean
worktree, exact workflow bytes, and the Community-only workflow inventory
before dependency setup or package scripts.

Required job:

- `community-release-gate`: installs dependencies and runs
  `pnpm verify:release` on `ubuntu-24.04`.

The Community release gate covers tests, typechecks, schemas, boundary checks,
source-drop secret scanning, dependency audit, the open Vault + Projects build,
and closed-feature leakage scans. Darwin-only Electron fuse and native Keychain
checks skip on Linux and remain mandatory local macOS release evidence.

Workflow actions are pinned to immutable commit SHAs instead of moving tags.
The workflow has read-only repository permissions and does not persist checkout
credentials. Routine hosted CI must remain Linux-only, use an explicit timeout,
and cancel stale runs for the same branch or pull request. When it executes
unchanged, its exact job/action/input/command inventory rejects environments,
secret or variable contexts, OIDC/write authority, and deployment, release,
Store, cloud, vendor, billing, or customer mutations.

The early guard is fast validation, not a security sandbox or proof of its own
immutability. A same-repository pull request proposes the workflow that GitHub
executes and can delete the guard or request token permissions before a step
runs. Workflow changes therefore require independent review of the exact diff
and head SHA. Live branch/ruleset and protected-environment controls are the
load-bearing enforcement for credentials, publication, release, and remote
mutation; green repository self-checks do not replace them.

## Dependency Automation

This generated repository keeps a valid Dependabot configuration but sets
version-update pull-request limits to zero. Dependency and GitHub Action version
changes originate in the canonical private source, pass private and Community
gates together, and arrive through a reviewed source regeneration. Security
alerts and security updates should remain enabled in GitHub repository settings.

## Local Checks

Use the smallest focused tests and typechecks below during ordinary iteration.
Run the full Community gate once at a security/source-boundary, milestone, or
release/publication checkpoint:

```sh
pnpm verify:release
```

Focused iteration checks:

```sh
pnpm test
pnpm exec tsc --noEmit --pretty false -p tsconfig.node.json
pnpm exec tsc --noEmit --pretty false -p tsconfig.web.json
pnpm check:boundaries
pnpm check:electron-fuses
pnpm check:keychain-boundary
pnpm check:release-metadata
pnpm check:script-targets
pnpm check:schemas
pnpm check:source-drop-secrets
pnpm audit --prod
pnpm audit --dev
pnpm build:open-local
pnpm check:open-artifact
pnpm check:bundle-budgets
pnpm check:preload-surfaces
```

## Publication Rules

Publication, release tags, signing, destructive repository operations, and
proceeding past failed or ambiguous evidence are human-gated. Green CI or an
automation-authored merge never supplies that approval.

The public `.github/workflows/community-release.yml` workflow is the only
official Community binary publication lane. It is manually dispatched from the
exact current `main` commit after a fresh matching tag already exists. An
Ubuntu preflight reruns the complete Community gate, one protected macOS job
builds and signs the universal app and DMG, then accepts the downloaded
artifact; an Ubuntu job attests and publishes the accepted assets. The default
`signed-evaluation` mode skips Apple notarization and labels the DMG and
prerelease **SIGNED EVALUATION — NOT NOTARIZED**. The `notarized` mode retains
explicit app/DMG notarization, stapling, and Gatekeeper checks. Publication uses
the same-repository
`GITHUB_TOKEN`; no cross-repository release token or maintainer PAT is used.

Configure the public `community-release` environment with the accountable
release reviewer and the mode-specific signing secrets documented in
`release-operations.md`. Signed evaluation uses certificate signing only;
notarized releases additionally require Apple account credentials. Configure the repository's tag
rules for `v*`. Those protections live in GitHub settings and cannot be proved
or weakened by this repository's YAML. Until those rules and GitHub immutable
releases are enabled, maintainers must treat published tags and releases as
append-only and never move, overwrite, or replace them. The protected workflow
alone uses `electron-builder.signed-evaluation.yml` or
`electron-builder.release.yml`; ordinary local packaging continues to use the
unsigned, non-notarizing `electron-builder.yml` contract.

Community `v0.x` releases use manual updates. The app does not check for or
install updates, and the release does not publish updater metadata. Users
download the next DMG from the official GitHub release and verify
`SHA256SUMS` before replacing the prior app.

Generated Vault + Projects parity syncs must preserve the public-owned release
overlay: `.github/workflows/community-release.yml`,
`electron-builder.signed-evaluation.yml`, `electron-builder.release.yml`, and
the generic macOS artifact record/selection helpers under `scripts/`. These
files govern publication in this repository;
they are not commercial feature surfaces and must not be replaced by the
private repository's release operator.

- Do not add Agent, CLI, Services/provider, browser extension, cloud/account,
  signing identity, or paid overlay code to the public Community source surface
  unless a new written decision explicitly changes the boundary.
- Keep `LICENSE`, `NOTICE`, `DISCLAIMER.md`, `SECURITY.md`, and
  `TRADEMARK.md` present.
- Security reports go to `security@vaultage.dev`.
- Avoid public issue details for suspected vulnerabilities until a coordinated
  disclosure timeline is agreed.

## Housekeeping and Handoff

- Preserve unrelated user changes and avoid destructive Git cleanup.
- Keep routine GitHub-hosted CI on Ubuntu; do not add hosted macOS, scheduled
  CI, or duplicate trigger coverage. The manually dispatched, serialized
  Community signing workflow is the sole hosted-macOS exception.
- Keep credentials, tokens, private keys, plaintext vault content, user project
  values, and private product/release evidence out of Git and logs.
- Update tests, docs, schemas, boundary checks, and source scans with every
  trust-boundary change.
- Report the exact commit, hosted CI run, artifact/source checks, remote
  mutations (normally none), rollback position, and remaining release blockers.
