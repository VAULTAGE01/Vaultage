# Community Release Operations

Status: required public-source operator runbook.

## Before Tagging

1. Confirm `package.json` contains the fresh candidate version. Never reuse an
   existing tag; `v0.1.0` and `v0.1.1` remain source-only prereleases.
2. Merge the reviewed candidate and confirm protected-branch CI passed on that
   exact current `main` commit.
3. Run `pnpm verify:release` and `pnpm publish:check` from a frozen-lockfile
   install, using hosted Linux CI when local storage cannot safely support it.
4. Create a fresh `v<version>` tag on that exact commit. Do not move or
   overwrite an existing tag. Repository-enforced tag protection and immutable
   releases are activation prerequisites, not properties currently guaranteed
   by this source workflow.
5. Refresh the Electron support snapshot from the official sources if its gate
   is expired.
6. Obtain legal approval for Apache-2.0 notices, third-party inventory, and
   trademark terms. Technical checks do not replace counsel review.

Configure the public `community-release` environment before dispatching the
workflow. It requires the Apple signing values named `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_NAME`, `CSC_LINK`, and
`CSC_KEY_PASSWORD`. Store values only as protected environment secrets; never
put them in source, workflow inputs, logs, or artifacts. The workflow publishes
with its same-repository `GITHUB_TOKEN` and does not require a release PAT.

Dispatch `.github/workflows/community-release.yml` from `main` with the exact
40-character candidate commit and matching tag. The workflow fails closed if
the dispatch SHA, current `main`, tag commit, and package version differ. Do not
dispatch the macOS job until the environment and signing inputs are ready.

Official desktop candidates must include the signed/notarized `vault-OC` DMG,
`SHA256SUMS`, dependency and packaged-app CycloneDX SBOMs, acceptance receipts,
and public build provenance. Community `v0.x` updates are manual: no updater
runtime or updater metadata is shipped. Install the
candidate on a separate macOS account and manually exercise a disposable vault,
project export, and backup/restore before promotion until signed-artifact E2E is
automated.

For a bad or compromised release, withdraw the affected download, preserve
evidence, rotate affected credentials, increment the version, and rebuild every
artifact from a reviewed commit. Never overwrite an old release in place. Release
rollback must not modify or downgrade user vault files, and support must never
request plaintext exports or passwords.
