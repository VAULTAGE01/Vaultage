# Vaultage Community release readiness

Status: **v0.1.4 is a published signed-evaluation prerelease — NOT NOTARIZED.**

This is the current public release record for Vaultage Community. It supersedes
the earlier statement that no signed assets, checksums, SBOMs, or provenance
were available. It is not a statement that Vaultage Community has an official
notarized macOS distribution, is production-ready, or has production billing
proof.

## Immutable public release record

- Release: [Vaultage Community v0.1.4 — SIGNED EVALUATION — NOT NOTARIZED](https://github.com/VAULTAGE01/Vaultage/releases/tag/v0.1.4), published as a prerelease on 2026-08-01.
- Tag: annotated [`v0.1.4`](https://github.com/VAULTAGE01/Vaultage/tree/v0.1.4), resolving to [`7012be0fd7070645e9a84dfd21c95bd6fb25f6b9`](https://github.com/VAULTAGE01/Vaultage/commit/7012be0fd7070645e9a84dfd21c95bd6fb25f6b9).
- Hosted release run: [Community macOS release #30712609842](https://github.com/VAULTAGE01/Vaultage/actions/runs/30712609842), a successful `workflow_dispatch` run on that exact commit.
- Mode: `signed-evaluation`; the release title, notes, and DMG name explicitly say **NOT NOTARIZED**.

The only distributed desktop binary is the universal macOS DMG below. Community
`v0.x` updates remain manual; this release does not ship updater metadata.

## Published assets and checksums

Verify downloaded assets against the published [`SHA256SUMS`](https://github.com/VAULTAGE01/Vaultage/releases/download/v0.1.4/SHA256SUMS) file before use.

| Asset | SHA-256 |
| --- | --- |
| [`vault-OC-0.1.4-universal-SIGNED-EVALUATION-NOT-NOTARIZED.dmg`](https://github.com/VAULTAGE01/Vaultage/releases/download/v0.1.4/vault-OC-0.1.4-universal-SIGNED-EVALUATION-NOT-NOTARIZED.dmg) | `98b13a38f85669c7682a62a12ec4803df0c13bfd9355626504400d697c97affc` |
| [`vaultage-dependencies.cdx.json`](https://github.com/VAULTAGE01/Vaultage/releases/download/v0.1.4/vaultage-dependencies.cdx.json) — dependency CycloneDX SBOM | `ddabe48efe6e11aa8460bf1f882ca7478559f22b112e12a3b953d640640984b5` |
| [`vaultage-artifact.cdx.json`](https://github.com/VAULTAGE01/Vaultage/releases/download/v0.1.4/vaultage-artifact.cdx.json) — packaged-app CycloneDX SBOM | `b5c854111bb3d0b93dafa9efce81f91e3a1ad4f13545e2552032f4e75c82411e` |
| [`packaged-mac-artifact-record.json`](https://github.com/VAULTAGE01/Vaultage/releases/download/v0.1.4/packaged-mac-artifact-record.json) | `185c466fa93c3e0a9ff1fe67efef9c0dbfe19544537a52fd2eb502a676812aaa` |
| [`community-dmg-acceptance.json`](https://github.com/VAULTAGE01/Vaultage/releases/download/v0.1.4/community-dmg-acceptance.json) | `8888ccd9e778648a634c9ecef2565f6cf62127a812dfc00055c8c67afbcd9d65` |

The packaged-artifact record and downloaded-DMG acceptance receipt agree on
the DMG digest above and the mounted app-bundle SHA-256:
`a131daae033e4dec4d0f2e0ac52b44072920e15754f432e9beab5ae69ebbc164`.
The acceptance receipt records `releaseTag: v0.1.4`, the exact release commit,
`releaseMode: signed-evaluation`, and `notarized: false`.

## Hosted signature, mount, launch, and provenance evidence

The successful macOS job in [run #30712609842](https://github.com/VAULTAGE01/Vaultage/actions/runs/30712609842/job/91402832691) recorded all of the following for the exact candidate:

- `Verify packaged Community signature, entitlements, and launch` passed after
  `codesign --verify --deep --strict`, universal-architecture validation,
  entitlement smoke validation, and packaged-app smoke launch validation.
- `Mount and accept the exact downloaded Community DMG` passed after mounting
  the retained downloaded DMG, finding `vault-OC.app`, repeating signature and
  architecture checks, and running the entitlement and packaged-app launch
  smoke checks against the mounted app.
- The release job created a [GitHub artifact attestation](https://api.github.com/repos/VAULTAGE01/Vaultage/attestations/sha256:98b13a38f85669c7682a62a12ec4803df0c13bfd9355626504400d697c97affc)
  for the released DMG digest; its workflow identity is the public
  `community-release.yml` workflow on `refs/heads/main` at the exact commit
  above.

These are hosted build-and-acceptance checks for the signed-evaluation artifact.
They do not assert Gatekeeper/notary success: the run intentionally skipped
notarization and stapling in `signed-evaluation` mode.

## Public-source boundary and provenance scope

The public provenance record is limited to the public
[`VAULTAGE01/Vaultage`](https://github.com/VAULTAGE01/Vaultage) tag, release,
workflow run, assets, checksums, SBOMs, and attestation named above. The
Community source boundary is Vault + Projects, as described in the
[architecture](docs/architecture.md) and [release provenance policy](docs/release-provenance.md).
This document neither includes nor infers private source, signing credentials,
customer data, commercial/cloud implementation, entitlement state, or billing
operation evidence.

## Remaining limitation

Official notarized distribution is deferred. Until a release is explicitly
published in `notarized` mode with Apple notarization, stapling, and Gatekeeper
checks, this v0.1.4 prerelease must remain labeled **SIGNED EVALUATION — NOT
NOTARIZED**. Users may need to right-click Open on first launch. Do not present
this record as production billing proof or as authorization to promote the
prerelease to an official notarized distribution.
