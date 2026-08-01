# Vaultage Community Changelog

## 2026-08-01 - v0.1.3 candidate

- Carries the current UI2026 Vault and Projects experience, including the
  neutral wider modal canvas and bounded mobile project review flow.
- Adds a public, protected macOS release lane with an explicit signed-evaluation
  mode and a preserved fully notarized mode, public provenance attestation,
  SBOMs, and `SHA256SUMS`.
- Labels signed evaluation artifacts and prereleases as **NOT NOTARIZED** and
  documents that macOS may require right-click Open.
- Corrects release packaging and acceptance to the actual `vault-OC.app`
  bundle while leaving ordinary local builds unsigned and non-notarizing.
- States the `v0.x` manual-update contract; no updater runtime or updater
  metadata is shipped.

## 2026-07-11 - Native credential boundary hardening

- The Keychain helper authenticates its direct parent and validates the
  containing app's signature/resource seal before accepting commands.
- Packaged Electron binaries disable Node execution and injection fuses and
  require embedded ASAR integrity plus ASAR-only app loading.
- Community gates exercise unauthorized callers, modified bundle rejection,
  and the package-time fuse policy.

## 2026-06-05 - Community Source Boundary

- Public source is limited to My Vault and local Projects.
- Community builds require no account.
- Closed automation, hosted account features, browser extension code, signing
  identities, and private release-channel modules are excluded from the public
  source distribution.
- Added Community release gates for tests, typechecks, schemas, boundary checks,
  source-drop secret scanning, dependency audit, open build verification, and
  closed-feature artifact scans.
