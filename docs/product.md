# Vaultage Community Product Brief

Vaultage Community is a local-first desktop vault for solo builders who need
one practical place to keep secrets, secure notes, and project `.env`
workflows.

## Product Surface

| Area | Included |
| --- | --- |
| My Vault | Encrypted local vault, folders, secrets, secure notes, import/export, reveal/copy controls, and local audit viewing/export. |
| Projects | Local project records, project scanning, env-key mapping, and explicit `.env` export. |

Vaultage Community does not require an account. The public source distribution
does not include closed commercial automation, hosted account features, browser
extension code, signing identities, or private release-channel modules.

## Principles

- **Local first.** The encrypted vault remains on the user's machine.
- **Explicit release of plaintext.** Copy, reveal, plaintext export, and
  project `.env` export are intentional user actions.
- **No background telemetry.** The desktop app should not report vault
  contents, project paths, secret names, or usage behavior.
- **Readable trust boundary.** Public source should make the Vault and Projects
  behavior inspectable without carrying private commercial implementation.

## Non-Goals

- No hosted sync in Community.
- No account requirement in Community.
- No remote provider automation in Community.
- No hidden scanning of project contents beyond explicit local project scans.
