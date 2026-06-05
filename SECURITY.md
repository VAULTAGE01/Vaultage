# Vaultage Security Policy

Vaultage is pre-release and has not been distributed to external users yet. Security issues are treated as release blockers.

## Supported Versions

Only the current pre-release branch is supported. Public support windows will be defined before a public release.

## Reporting

Report suspected vulnerabilities privately to:

```text
security@vaultage.dev
```

Do not publish exploit details, screenshots of secrets, vault files, provider
tokens, or `.env` contents in public channels.

Expected response:

- First human response: within 2 business days.
- Triage target: within 7 calendar days.
- Remediation target: severity-dependent, with critical issues treated as
  release blockers.

Coordinated disclosure:

- Send a concise report with impact, affected version or commit, reproduction
  steps, and whether the issue touches real secret material.
- Use test vaults and throwaway provider tokens whenever possible.
- Do not publicly disclose until the issue is fixed or a coordinated timeline
  has been agreed.
- Vaultage will credit reporters on request unless anonymity is preferred.

## Current Security Model

Vaultage is designed around a local-first trust boundary:

- Vault data is encrypted locally.
- The decrypted vault key lives only in memory while unlocked.
- Touch ID is used for unlock convenience and user-presence confirmation on macOS.
- Public Community builds expose only My Vault and Projects.
- Private/Pro Agent mode is local-only and must be explicitly enabled while the vault is unlocked.
- Plaintext export paths require explicit confirmation and must be treated as sensitive.
- Private/Pro provider credentials are stored inside the encrypted vault and provider API calls run behind a worker-thread RPC boundary. ADR-024 keeps Agent and provider workflows in the paid/private surface.
- Sensitive main-process events are recorded in a redacted hash-chained local audit log foundation.

## In Scope

- Desktop app main/preload/renderer code.
- Private/Pro Local Agent API on `127.0.0.1`.
- Vault encryption, unlock, lock, backup, import, and export behavior.
- Provider integration code currently shipped in the desktop app.
- Build and packaging configuration.
- Future open-core package boundaries and public protocol/schema docs.

## Out of Scope For Now

A paid hosted/sync tier is not implemented yet. Managed OAuth, token lifecycle
automation, browser extension workflows, cloud token custody, account security,
logging, abuse controls, sync, and cloud audit retention require their own
threat model and review before any beta. Vaultage's current plan rejects
request-path provider proxying.

## Sensitive Data Handling

When testing or reporting issues:

- Use test vaults and throwaway provider tokens.
- Do not attach real vault files, `.env` files, screenshots of secret values, or production provider credentials.
- Redact request/response bodies that contain token material.
- Include versions, operating system, reproduction steps, and impact.

## Release Security Gates

A public release must not happen until:

- Dependency audit has no known actionable vulnerabilities.
- Private/Pro Local Agent API browser-origin exfiltration paths are closed.
- Sensitive IPC surfaces have runtime validation.
- Plaintext export and Agent approval flows require explicit user presence.
- Electron is on a patched supported line.
- A security contact and disclosure process exist.
- The free/open and paid/closed code boundaries are documented.
