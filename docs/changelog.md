# Vaultage Community Changelog

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
