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
  CI, duplicate trigger coverage, or workflows without stale-run cancellation.
- Keep credentials, tokens, private keys, plaintext vault content, user project
  values, and private product/release evidence out of Git and logs.
- Update tests, docs, schemas, boundary checks, and source scans with every
  trust-boundary change.
- Report the exact commit, hosted CI run, artifact/source checks, remote
  mutations (normally none), rollback position, and remaining release blockers.
