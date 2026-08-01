# Vaultage Community Security Architecture

Vaultage Community is a local desktop vault for **My Vault** and local
**Projects**. This page describes the Community build as it is implemented;
it does not describe hosted, provider, browser-extension, or agent workflows.
For responsible disclosure, see [SECURITY.md](../SECURITY.md).

## Trust boundary

Vaultage uses an Electron renderer, a sandboxed preload bridge, and a main
process. The renderer receives redacted vault snapshots. Sensitive values are
resolved by the main process only for a requested local action such as reveal,
copy, or export.

```text
React renderer
  -> sandboxed preload API
  -> Electron main process
  -> encrypted vault file, local audit log, project files, macOS Keychain helper
```

The Community preload surface includes only local vault and project actions.
The release checks reject private feature IPC from the Community package.

## Key custody and encryption

- A new vault receives a randomly generated 256-bit vault key.
- The master password is processed with scrypt using `N=131072`, `r=8`,
  `p=1`, a 32-byte random salt, and a 32-byte derived key. The implementation
  permits up to 256 MiB for the derivation.
- The derived key wraps the vault key. Changing the master password re-wraps
  that key rather than deriving the vault key from the password.
- Vault contents are encrypted with AES-256-GCM. Each write uses a fresh
  12-byte IV; the stored payload is `[IV][authentication tag][ciphertext]`.
- On macOS, the vault key may be stored in the local Keychain with
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and an OS-enforced
  user-presence policy. Local development builds can use a Keychain fallback
  when the access-control entitlement is unavailable; retrieval still requests
  local user presence.

Vaultage does not claim that the vault key is held in the Secure Enclave.

## Desktop hardening

The Community windows use Electron renderer sandboxing, context isolation, and
disabled Node integration. The preload API is an explicit bridge rather than
an unrestricted Node API. New-window requests and renderer navigation are
denied. The production renderer policy limits connections to `self`, disables
objects, disallows framing, and disallows remote scripts.

Password fields use macOS Secure Event Input while focused when the bundled
Keychain helper is available. The app also disables that protection when the
window loses focus or closes.

## Sensitive local actions

Plaintext export is a deliberate declassification step. Community requires a
fresh confirmation before `.env` export: on macOS this reuses Keychain
user-presence confirmation; on other platforms it requires the exact typed
confirmation phrase. The project export path is validated and the export is
recorded in the local audit log without secret values.

Audit records are stored locally with a hash chain. When the vault key is
available, records use an HMAC-SHA-256 key derived from it. Audit details are
redacted for sensitive field names before persistence. This supports local
tamper-evidence; it is not a substitute for an independently operated audit
service.

## Important limitations

- While a vault is unlocked, decrypted material necessarily exists in the
  local application process to perform requested actions.
- Exported `.env` and plaintext JSON files are readable by processes that can
  read their destination. Treat each export as sensitive data.
- Vaultage cannot protect against malware already running with the user’s
  privileges, physical compromise of an unlocked session, or an unreviewed
  build.
- Security properties apply to the released Community package, not to an
  arbitrary local source checkout or development environment.

## How to help

Report suspected vulnerabilities privately as described in
[SECURITY.md](../SECURITY.md). Do not include real secrets, vault files, or
plaintext exports in public issues or discussions. Security-affecting pull
requests should explain the changed trust boundary and include focused tests.
