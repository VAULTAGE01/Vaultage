# Contributing To Vaultage

Vaultage is pre-release. Contributions to the public Vault + Projects Community
surface are welcome through fork pull requests. Commercial Agent, Services,
provider, extension, account, entitlement, and release-custody code remains out
of scope unless a written public-boundary decision changes that contract.

## Clean Fork And Worktree Protocol

Use a personal or automation-owned GitHub account that does not own the
upstream repository. Do not share or switch to a maintainer credential merely
to contribute.

```sh
git clone git@github.com:YOUR_ACCOUNT/Vaultage.git
cd Vaultage
git remote add upstream https://github.com/VAULTAGE01/Vaultage.git
git fetch --prune upstream
git switch -c feature/short-task-name upstream/main
pnpm install --frozen-lockfile
pnpm contributor:preflight
```

The preflight fails when the checkout is dirty, detached, on `main`, stale
against fetched upstream `main`, missing a distinct contributor fork, or uses a
remote URL containing embedded credentials. Use one branch and one clean
worktree per task. Do not reuse the maintainer's canonical checkout or another
agent's worktree.

After committing and before opening the pull request:

```sh
pnpm contributor:finish
git push -u YOUR_FORK_REMOTE feature/short-task-name
```

The finish check requires a clean named branch with committed work descending
from fetched upstream `main` and prints the verified fork remote name to use in
the push command. In a new fork clone this is normally `origin`; in a shared
checkout it may have another name. Open a pull request from the fork into
`VAULTAGE01/Vaultage:main`; never push directly to upstream `main`. Required
GitHub-hosted Ubuntu CI is the merge checkpoint.

## Before Contributing

- Do not include real secrets, vault files, provider tokens, screenshots of secret values, or `.env` contents.
- Do not commit generated dependencies, build output, local evidence, editor
  state, `.operator` data, or another contributor's unfinished changes.
- Open a discussion or issue before large architectural changes.
- Security-sensitive changes must describe their threat-model impact.
- Agent workflows, CLI helpers, Services/provider code, provider lifecycle
  automation, cloud account code, managed OAuth, browser extension code, and
  paid overlay modules must stay out of the Community source surface unless
  explicitly relicensed.
- Accepted Vault, Projects, and shared UI contributions are reconciled into the
  private composition source through a maintainer-reviewed import PR. Do not
  edit provenance manifests or generated output; those changes are rejected.

## Development Checks

Run these before opening a pull request:

```sh
pnpm test
pnpm exec tsc --noEmit --pretty false -p tsconfig.node.json
pnpm exec tsc --noEmit --pretty false -p tsconfig.web.json
pnpm audit --dev
pnpm verify:release
pnpm contributor:finish
```

## Commit/PR Expectations

- Keep changes scoped.
- Use one task branch and one clean worktree. Rebase or merge current upstream
  `main` before review when it moved; do not overwrite published history or use
  an unguarded force push.
- Add or update tests for behavior changes.
- Update docs when changing security guarantees, open-source boundaries, audit events, or plaintext export behavior.
- Never weaken runtime validation or Electron hardening without an explicit security rationale.

## Certificate Of Origin

The recommended public posture is Developer Certificate of Origin sign-off rather than a CLA:

```text
Signed-off-by: Your Name <you@example.com>
```

Add the sign-off when the contribution is intended for upstream inclusion.
