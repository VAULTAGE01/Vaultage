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

- a Developer ID signed macOS artifact,
- an explicit `SIGNED-EVALUATION-NOT-NOTARIZED` filename and release warning
  when Apple notarization was skipped,
- SHA-256 checksums,
- build provenance attestation where the hosting platform supports it,
- CycloneDX dependency and packaged-app SBOMs.

Community `v0.x` updates are manual. The app intentionally has no updater
runtime, and releases do not publish updater metadata. Download the next DMG
from the official GitHub release and verify it before replacing the prior app.

Signed evaluation prereleases are **not notarized** and must not be presented as
production-ready. macOS may require **right-click Open** on first launch.

## Verification

Users should verify:

- the download comes from an official Vaultage release channel,
- the checksum matches `SHA256SUMS`,
- the code signature identifies the expected signing identity,
- Gatekeeper/stapler validation passes only when the release is labeled
  notarized,
- the source tag or commit matches the published release notes.

## Boundary Check

Community artifacts must not contain Pro lifecycle implementation, cloud account
code, managed OAuth callbacks, browser extension code, signing secrets, private
planning reports, or generated helper binaries in the source tree.

The release gate enforces this through boundary checks, source-drop secret
scanning, open artifact scanning, and publish-readiness checks.
