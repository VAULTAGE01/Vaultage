# Vaultage Community CI

Status: public Community source protocol.

This is the canonical delivery and repository-housekeeping policy for humans,
Codex-based agents, Claude-based agents, and other automation. `AGENTS.md`
and `CLAUDE.md` point here.

## Branches

- `main`: release-candidate branch. Must stay green.
- Feature branches: short-lived branches merged by pull request.

Protect `main` so pull requests require the `community-release-gate` job
and maintainer review.

## Pull Request CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` or
`develop`.

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
and cancel stale runs for the same branch or pull request.

## Dependency Automation

`.github/dependabot.yml` asks Dependabot to check root npm/pnpm dependencies
and GitHub Actions weekly. Security alerts and security updates should remain
enabled in GitHub repository settings.

## Local Checks

Run the full Community gate:

```sh
pnpm verify:release
```

Useful focused checks:

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
