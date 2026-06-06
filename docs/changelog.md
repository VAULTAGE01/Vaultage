# Vaultage Community Changelog

## 2026-06-06 - Downloadable Community Desktop Release Path

- Added official Community macOS release workflow for signed/notarized DMG and
  zip artifacts.
- Added release checksum generation and macOS signing/notarization assertions.
- Moved Community builds to their own bundle ID and Keychain namespace.
- Updated the Community background animation to the light grey release palette.

## 2026-06-05 - Community Source Boundary

- Public source is limited to My Vault and local Projects.
- Community builds require no account.
- Closed automation, hosted account features, browser extension code, signing
  credentials, and private paid modules are excluded from the public source
  distribution.
- Added Community release gates for tests, typechecks, schemas, boundary checks,
  source-drop secret scanning, dependency audit, open build verification, and
  closed-feature artifact scans.
