# Vaultage Community Release Provenance

Status: enforced pre-release verification policy; legal approval remains open.

## Source

Public Community source is this repository. It should include only the
Vault + Projects boundary described in the README and repo-structure docs.

Before tagging or announcing a Community source release, run:

```sh
pnpm verify:release
```

The gate runs tests, typechecks, schemas, boundary checks, source-drop secret
scanning, dependency audit, the open Vault + Projects build, and open artifact
leak checks.

## Desktop Artifacts

Public desktop builds should publish:

- signed/notarized macOS artifact when available,
- SHA-256 checksums,
- updater metadata for official builds,
- build provenance attestation where the hosting platform supports it,
- CycloneDX dependency and packaged-app SBOMs.

Unsigned pre-release builds must be labeled as such and must not be presented as
production-ready.

## Verification

Users should verify:

- the download comes from an official Vaultage release channel,
- the checksum matches `SHASUMS256.txt`,
- macOS Gatekeeper/notarization identifies the expected signing identity,
- the source tag or commit matches the published release notes.

## Boundary Check

Community artifacts must not contain Pro lifecycle implementation, cloud account
code, managed OAuth callbacks, browser extension code, signing secrets, private
planning reports, or generated helper binaries in the source tree.

The release gate enforces this through boundary checks, source-drop secret
scanning, open artifact scanning, and publish-readiness checks.
