# Community Release Operations

Status: required public-source operator runbook.

## Before Tagging

1. Confirm protected-branch CI passed on the exact candidate commit.
2. Run pnpm verify:release from a frozen-lockfile install.
3. Run pnpm publish:check and confirm the tree contains no generated output.
4. Confirm the package version and create only the matching v<version> tag.
5. Refresh the Electron support snapshot from the official sources if its gate
   is expired.
6. Obtain legal approval for Apache-2.0 notices, third-party inventory, and
   trademark terms. Technical checks do not replace counsel review.

Official desktop candidates must include signed/notarized artifacts, updater
metadata, checksums, dependency and packaged-app CycloneDX SBOMs, and
provenance. Install the
candidate on a separate macOS account and manually exercise a disposable vault,
project export, and backup/restore before promotion until signed-artifact E2E is
automated.

For a bad or compromised release, stop updater promotion, preserve evidence,
rotate affected credentials, increment the version, and rebuild every artifact
from a reviewed commit. Never overwrite an old release in place. Release
rollback must not modify or downgrade user vault files, and support must never
request plaintext exports or passwords.
