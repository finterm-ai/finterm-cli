# Releasing the Finterm CLI

This is the release runbook for the `@finterm-ai/cli` npm package (the `finterm`
command). It has two parts:

- **One-time bootstrap** — the first manual publish that claims the package name, plus
  the GitHub Actions Trusted Publisher (OIDC) setup that lets every later release
  publish from CI with no token.
  Done once, ever.
- **Ongoing releases** — the automated flow for every version after the first: bump,
  tag, push. CI publishes.

The package lives in `packages/finterm-cli` and publishes as the scoped npm package
`@finterm-ai/cli` with the `finterm` binary.
The release workflow is
[`.github/workflows/release.yml`](../.github/workflows/release.yml).

## Operating mode (agent and human roles)

Publishing is **irreversible and outward-facing**: a published version cannot be
re-published, and unpublishing is restricted and disruptive.
This is a human-in-the-loop process.
An agent prepares and verifies everything; two things are always the human maintainer’s:

- **Authentication.** The agent never logs in or holds credentials.
  The maintainer authenticates the npm CLI (browser plus 2FA), and the agent verifies
  the result.
- **Confirmation of every state-changing step.** Read-only checks (`npm whoami`,
  `npm pack --dry-run`, `pnpm run ci`) may run as the agent narrates them.
  Anything that writes to the registry — the bootstrap `npm publish`, pushing a release
  tag — is a hard stop that the maintainer confirms and, for the bootstrap publish,
  runs.

## When a release is required (triggers)

The CLI embeds **copies of the server contract**: tool and bundle ids and example
commands in the agent docs (`src/docs/finterm-docs.md`, `finterm-prime.md`, `SKILL.md`,
`skill-brief.md`), command code (`src/cli/commands/*`), and the mock API client.
The public API has **no alias or rename layer** (finterm Decision 16, greenfield): an id
that changes server-side makes every embedded reference a 404. So a release is
**required, coordinated with the server deploy**, when any of these land server-side:

1. **Tool or bundle id added, renamed, or removed** (commits marked `feat(api)!` are the
   red flag — e.g. the `company_web_research` → `company_deep_research` rename).
2. **Endpoint paths, the `{ finterm, data }` envelope, or error codes** change in a way
   the CLI renders or documents.
3. **Auth or login-flow changes** (device flow endpoints, token format, 402 payload).
4. **Embedded docs drift** from the served catalog even without a code change.

CLI-only fixes (output ergonomics, help text) batch on their own schedule and need no
coordination.

**Coordination order for breaking id changes:** the server change must NOT deploy to
production before the matching CLI version is published (there is no alias to bridge the
gap). Sequence: merge the server change → release the CLI carrying the new ids → deploy
production → verify with the deployed-tier end-to-end QA runbook (maintained alongside
the server).

**The check (agent-runnable, read-only), run before any production API deploy:**

```bash
npm view @finterm-ai/cli version          # published…
git -C <finterm-cli> log --oneline -1     # …vs repo HEAD (clean tree = nothing pending)
# ids the CLI embeds vs the served catalog:
grep -rho "company_[a-z_]*\|ticker_data" packages/finterm-cli/src | sort -u
finterm tool --help                        # served tool/bundle ids
# breaking server changes since the last release: check the server repo's
# release notes / feat(api)! commits (server maintainers own that check).
```

## One-time bootstrap

### Why a manual first publish is needed

npm Trusted Publishing (OIDC) is configured on a package that **already exists**: you
open the package on npmjs.com and attach a GitHub Actions publisher.
A brand-new package is not on npm yet, so the trusted publisher cannot be set first.
The order is fixed:

1. Publish the first version by hand, authenticated as a maintainer (no provenance —
   provenance needs CI’s OIDC identity, which a local machine does not have).
2. Configure the trusted publisher on the now-existing package.
3. Every release after that publishes automatically from `release.yml` over OIDC,
   tokenless and with provenance.

### Phase 0: pre-flight (agent, read-only)

Run from the repo root unless noted; none of these change anything.

1. **Name is free** (only relevant for the very first publish):
   `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/@finterm-ai%2Fcli`
   returns `404`.

2. **Version is intended:**
   `node -p "require('./packages/finterm-cli/package.json').version"` is the version you
   mean to claim.

3. **The full suite is green and the tarball is right:**

   ```bash
   pnpm install --frozen-lockfile
   pnpm run ci          # format, lint, types, tests, build, publint, pack smoke, boundary scan
   cd packages/finterm-cli && npm pack --dry-run && cd -
   ```

   `pnpm run ci` already includes the packed-artifact smoke test (`test:pack`), so a
   green `ci` means the tarball installs and runs from a clean prefix.

### Phase 1: authenticate (maintainer), then verify (agent)

1. Agent checks state: `npm whoami` (a `401`/`E401` means not logged in).

2. Maintainer logs in (browser plus 2FA — the agent cannot do this):

   ```bash
   npm login          # defaults to --auth-type=web
   ```

3. Agent confirms: `npm whoami` prints the maintainer account; `npm profile get` shows
   the account and the two-factor mode.

4. Agent reads the 2FA mode from `npm profile get`:
   - **`auth-and-writes`:** `npm publish` requires a one-time password.
     The maintainer runs the publish (or supplies `--otp=<code>`); the agent cannot
     enter the OTP.
   - **`auth-only` (or 2FA off):** the web session is enough; after explicit
     confirmation the maintainer runs the publish, or authorizes the agent to.

### Phase 2: publish the first version (hard confirmation gate)

Run from the **package directory**, not the repo root.
The repo root `package.json` is `"private": true`, so publishing from there fails with
`EPRIVATE` — a deliberate guard against a wrong-directory publish.

```bash
cd packages/finterm-cli
npm publish --access public --no-provenance
```

- `--access public` is required to publish a scoped package (`@finterm-ai/cli`)
  publicly; scoped packages default to restricted.
- `--no-provenance` is required for a local publish: provenance needs CI’s OIDC
  identity. Automated releases add provenance later.
- `npm publish` runs the package’s `prepack` script first (`pnpm run build`), so the
  artifact is freshly built from source.

Then the agent verifies: `npm view @finterm-ai/cli version` returns the bootstrap
version, and `https://registry.npmjs.org/@finterm-ai%2Fcli` no longer returns `404`.

### Phase 3: configure the trusted publisher (maintainer, web UI)

On npmjs.com, open the **@finterm-ai/cli** package, then Settings, then **Trusted
Publishing**, add a GitHub Actions publisher, and enter exactly:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `finterm-ai` |
| Repository | `finterm-cli` |
| Workflow filename | `release.yml` |
| Environment | leave blank |

The workflow filename is the bare name, not a path, and must match the file on the
default branch. npm does not verify the configuration when you save it — a wrong field
surfaces only on the next publish attempt.

After this, the bootstrap is complete and the package never needs a manual publish or a
stored npm token again.
Optionally `npm logout` if this was a shared machine.

> **Provenance and repository visibility.** Automated releases publish with
> `--provenance`, which attaches a public build attestation that links to this
> repository. Keep provenance releases for when the repository is public; the bootstrap
> publish above uses `--no-provenance` and works regardless.

## Ongoing releases (automated, every version after the first)

Once the bootstrap is done, releasing is three steps.
CI does the rest.

1. **Bump the version** in `packages/finterm-cli/package.json` and add a `CHANGELOG.md`
   entry. Use semver: patch for fixes, minor for additive features, major for breaking
   changes. (`0.x` is pre-stable: minor bumps may carry breaking changes.)

2. **Land it on `main`** through a pull request, green CI.

3. **Tag and push** from the merge commit on `main`:

   ```bash
   git checkout main && git pull
   git tag v0.1.1            # the v-prefixed package.json version
   git push origin v0.1.1
   ```

Pushing a `v*` tag triggers [`release.yml`](../.github/workflows/release.yml), which:

- runs `pnpm run ci` (the same full suite as PR CI),
- verifies the tag matches `packages/finterm-cli/package.json` version and refuses a
  dirty build version,
- publishes over OIDC trusted publishing with provenance — no npm token anywhere.

A `workflow_dispatch` run (the “Run workflow” button) runs every step except the
publish, so you can dry-run the release pipeline on a branch without uploading anything.

### Notes

- **One tag, one version.** npm rejects re-publishing a version.
  If a release fails after upload, bump to the next patch; do not retry the same
  version.
- **The release runner needs Node >= 22.14 and npm >= 11.5.1** for OIDC; `release.yml`
  pins both. Bump them deliberately, not to `@latest`.
- **Never add a `NODE_AUTH_TOKEN`/`NPM_TOKEN` secret** for releases.
  Trusted publishing is tokenless by design; a stored token reintroduces the leak risk
  it removes.

<!-- This document follows common-doc-guidelines.md.
-->

## Server-First Sequencing

Commands that call new API endpoints ship only after those endpoints are live in
production. The release workflow enforces this mechanically: before publishing, it
fetches `https://api.finterm.ai/api/v1/openapi.json` and fails the release if a path
the CLI depends on (currently `/api/v1/feedback` and `/api/v1/account`) is missing.
If that gate fails, deploy the server side first, confirm the path appears in the
production OpenAPI document, then re-run the release.
