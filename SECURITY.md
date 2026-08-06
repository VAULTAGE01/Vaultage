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
- A working key copy exists in main-process memory while unlocked. At rest,
  the key is wrapped under a scrypt-derived key and may also exist in a
  this-device-only macOS Keychain item gated by local user presence. Touch ID
  is used when available; macOS may offer system-password fallback.
- Public Community builds expose only My Vault and Projects.
- Closed Free Agent mode is local-only and must be explicitly enabled while the vault is unlocked.
- Closed Free keeps unlimited local Vault storage and unlimited Projects plus that local Agent/CLI
  access. The sole released paid capability is Services/provider lifecycle;
  the browser extension is deferred and unavailable.
- Plaintext export paths require explicit confirmation and must be treated as sensitive.
- Trial/Pro Services credentials are stored inside the encrypted vault and provider API calls run behind a worker-thread RPC boundary. ADR-024 keeps Agent and provider workflows out of the Community surface.
- Sensitive main-process events are recorded in a redacted hash-chained local audit log foundation.
- Optional paid-beta accounts add a metadata-only cloud control plane for
  identity, device authorization, billing state, signed entitlements, account
  export, deletion, and recovery notifications. It does not receive vault
  plaintext, vault root keys, master passwords, or local project values.

### Trust boundary limitations

The local-first model has two consequences that are explicit boundaries, not
defects. Users and reviewers should treat them as documented trade-offs:

- Biometric unlock bounds at-rest confidentiality by the macOS account, not by
  the master password. When Touch ID unlock is enabled, the vault key lives in
  a this-device-only Keychain item released on local user presence — Touch ID
  or the macOS account password. An attacker who can satisfy either (for
  example, an already-unlocked Mac or a known login password) can recover the
  key and decrypt the vault regardless of the master password. For the
  strongest at-rest posture, leave Touch ID storage disabled and unlock with
  the master password only.
- Biometric protection depends on an authentic, signed build. Official releases
  run under the macOS hardened runtime and store the key under a user-presence
  access-control policy. Unsigned or ad-hoc local builds cannot create that
  policy and fall back to a device-only Keychain item that is readable while the
  account is unlocked without a per-read presence check. Treat only official
  signed releases as biometrically protected; unlock a self-built binary with
  the master password only.

## In Scope

- Desktop app main/preload/renderer code.
- Closed Free Local Agent API on `127.0.0.1`.
- Vault encryption, unlock, lock, backup, import, and export behavior.
- Provider integration code implemented in the private desktop source.
- Paid-beta account, session-refresh, device-enrollment/revocation, billing,
  webhook, entitlement, recovery-notification, export, and deletion surfaces.
- Commercial entitlement enforcement for Services lifecycle, including
  offline/grace transitions. The browser extension remains deferred and unavailable.
- Cloudflare Worker service bindings, queues, D1/R2 lifecycle controls,
  rate limits, redacted operational logging, and deployable configuration
  defined for the paid-beta control plane in the private cloud repository.
  Source or configuration presence is not evidence of live activation.
- Build and packaging configuration.
- Current generated open-core source boundaries and public protocol/schema docs.

## Out of Scope For Now

Managed provider OAuth, provider-token custody, encrypted cloud vault copies,
multi-device vault sync, cloud audit retention, and cloud spend aggregation are
not part of the paid-beta launch scope. Those deferred capabilities require
their own threat-model updates and release review before activation. Vaultage's
current plan rejects request-path provider proxying.

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
- Paid-beta identity, billing, entitlement, recovery, export, and deletion
  boundaries pass their private-cloud release gates and staged operational drills
  before external activation.
