# Vaultage native vNext public boundary

Vaultage is moving its first-party clients to native Apple platforms while the
current Electron app remains the shipping product and rollback authority. This
repository keeps its existing history, issues, security policy, license, and
release records; the pivot does not restart the project or rewrite history.

## Repository lines

- `main` remains the current Electron Community line until an explicit native
  cutover.
- `legacy/electron` preserves the exact pre-pivot public baseline.
- `native-vnext` is the public migration line for the new implementation.

No branch name makes a build production-ready. Releases continue to require
their own signed artifact, compatibility, and acceptance evidence.

## Product sequence

1. macOS desktop first: native SwiftUI application, a separately signed local
   Broker, local encrypted vault, lock/unlock, record use, Projects, and
   recovery compatibility.
2. iOS fast-follow: native retrieval, Password AutoFill, passkey and TOTP use,
   and encrypted recovery handoff through the smallest approved App Group
   surface.
3. Windows and Android follow only after the shared behavioral contracts are
   stable. Their clients remain native to their operating systems rather than
   inheriting an Electron runtime.

The implementation favors platform cryptography and credential APIs. It does
not introduce a custom cipher, KDF, signature scheme, wire format, or storage
format merely to make the rewrite look independent.

## Public export rule

The private production workspace is the implementation authority during the
transition. Public source is exported by an allowlist, never by merging or
copying that repository wholesale. A public export may contain only reviewed
client/core source, tests, non-sensitive fixtures, documentation, and build
metadata that are intentionally licensed under Apache-2.0.

Every export must reject:

- credentials, signing material, provisioning profiles, account identifiers,
  customer data, local evidence, and build artifacts;
- commercial account, billing, entitlement, provider, hosted execution, and
  other closed-service implementation;
- generated files or dependencies whose licenses are not compatible with this
  repository;
- paths not present in the explicit export manifest.

The initial public layout will mirror the native product boundaries rather
than the historical Electron process tree:

```text
macos/                SwiftUI desktop app and Broker composition
ios/                  iOS app and Password AutoFill extension
shared/VaultageCore/  platform-neutral Swift domain and compatibility code
tests/                public behavior, compatibility, and boundary tests
```

The Broker remains the plaintext/key authority on macOS. UI clients receive
only the values explicitly needed for a user-approved action. iOS gets only
the separately scoped data required for retrieval and system credential use.

## Cutover rule

Native vNext replaces the Electron Community line only after it can safely
open supported existing data, exercise the promised local workflows, preserve
recovery, and ship as a signed accepted macOS artifact. Until then:

- the Electron app remains the production writer and updater;
- native builds use app-private development data and do not mutate customer
  vaults;
- the marketing download continues to point to the current pre-pivot app;
- migration is additive and reversible.

This boundary is intentionally small. Detailed implementation work belongs in
the native source and issue tracker, not in a parallel architecture-document
stack.
