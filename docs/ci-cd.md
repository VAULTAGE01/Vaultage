# Vaultage Community CI

Status: public Community source protocol.

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
  `pnpm verify:release`.

The Community release gate covers tests, typechecks, schemas, boundary checks,
source-drop secret scanning, dependency audit, open Vault + Projects build,
and closed-feature leakage scans.

Workflow actions are pinned to immutable commit SHAs instead of moving tags.

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
pnpm check:schemas
pnpm check:source-drop-secrets
pnpm audit --dev
pnpm build:open-local
pnpm check:open-artifact
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
