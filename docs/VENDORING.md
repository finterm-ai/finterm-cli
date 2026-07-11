# Vendored Dataroom Packages

The `src/` trees of `packages/dataroom` and `packages/dataroom-cli` are **vendored**:
their canonical home is the private upstream monorepo maintained by the Finterm team,
and this repository takes them **only** via the sync script.
They are bundled into the published CLI at build time; they are not published as
standalone packages from here.

## The rule

**Never edit the vendored `src/` trees in this repository.** Not for bug fixes, not for
lint appeasement, not for “small” doc tweaks.
Every change goes to the upstream first, then arrives here via a sync.
This rule exists because these copies drifted once before; the gates below make that
mistake impossible to merge rather than merely discouraged.

## How it works

- `vendor-manifest.json` (repo root) records the upstream ref and a content hash of each
  vendored tree, written by the sync script.
  Do not edit it by hand.
- `pnpm dataroom:check` recomputes the hashes and fails on any deviation.
  It runs at the front of the `precommit` script and of `pnpm ci` (which the release
  workflow runs), so a local edit of vendored code cannot reach a release.
  Note `precommit` is a package script to run before committing — this repo installs no
  git hook that intercepts commits automatically.
- Each vendored package carries a `VENDORED.md` marker pointing here.
- The vendored trees are excluded from this repo’s prettier and eslint runs: the
  upstream owns formatting and lint for them, and the copies stay byte-identical.
  This repo still typechecks, tests, and bundles them.

## Syncing (maintainers and agents with upstream access)

```bash
pnpm dataroom:sync --from <path-to-upstream-checkout>
# or: DATAROOM_UPSTREAM_DIR=<path> pnpm dataroom:sync
```

The sync requires the upstream vendored trees to be git-clean, copies the `src/` trees
byte-identical, and rewrites `vendor-manifest.json` with the upstream ref and fresh
hashes. Syncing twice from the same ref is a no-op.

**When to sync:** as a mandatory step of every release (see
[RELEASING.md](RELEASING.md)), and any time an upstream fix is needed here sooner.
Scope is `src/` only — each repo owns its own `package.json`, tsconfig, and test-runner
configs.

## When a change seems needed locally

1. Do not edit the vendored tree here.
2. Open the change in the upstream (or file it with the Finterm team if you do not have
   access), get it landed there.
3. Re-run the sync and commit the refreshed trees plus `vendor-manifest.json`.

If `dataroom:check` fails on your branch, you (or a tool you ran) edited vendored code:
revert the local change and follow the steps above.
