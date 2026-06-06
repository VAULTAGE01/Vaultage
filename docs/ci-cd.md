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

## Desktop Release Workflow

`.github/workflows/release-community.yml` creates official Community desktop
releases on tags matching `v*` or by manual dispatch.

The release workflow:

- installs dependencies from the lockfile,
- runs `pnpm verify:release`,
- builds a universal macOS app with hardened runtime,
- signs the app with a Developer ID Application certificate from GitHub
  Secrets,
- notarizes and staples the app with Apple notarytool credentials from GitHub
  Secrets,
- asserts code signing, stapling, Gatekeeper acceptance, bundle identity, and
  packaged Keychain helper placement,
- publishes a DMG, zip, updater metadata, blockmap files, and
  `SHASUMS256.txt` to the GitHub release.

GitHub automatically publishes source `.zip` and `.tar.gz` archives for the
same tag, so source remains available alongside the desktop download.

Required repository secrets:

| Secret | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded Developer ID Application certificate export. |
| `MACOS_CERTIFICATE_PASSWORD` | Password for the certificate export. |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect API key file. |
| `APPLE_API_KEY_ID` | App Store Connect API key ID. |
| `APPLE_API_ISSUER` | App Store Connect issuer ID. |

Never commit certificate files, Apple API key files, or private key text.

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
  signing credential, or paid overlay code to the public Community source
  surface unless a new written decision explicitly changes the boundary.
- Official Community binaries may be signed and notarized by CI, but signing
  credentials must remain in GitHub Secrets and outside the source tree.
- Keep `LICENSE`, `NOTICE`, `DISCLAIMER.md`, `SECURITY.md`, and
  `TRADEMARK.md` present.
- Security reports go to `security@vaultage.dev`.
- Avoid public issue details for suspected vulnerabilities until a coordinated
  disclosure timeline is agreed.
