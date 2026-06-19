# Supply-Chain Security

Install and upgrade dependencies conservatively.
These rules limit exposure to compromised or freshly published malicious packages.

## Rules

- Install with `pnpm install --frozen-lockfile` so the resolved tree matches
  `pnpm-lock.yaml` exactly.
- Keep the project `.npmrc` release-age gate enabled.
  It sets `minimum-release-age=20160` (14 days), so a newly published version cannot be
  installed until it has been public for two weeks.
- Do not update dependencies without reviewing the lockfile diff.
- Do not add lifecycle-script exceptions without human review.
- Do not use unpinned zero-install runners such as unversioned `npx`, `pnpm dlx`, or
  `curl | sh`.

## Publishing

Maintainers publish the package to npm with provenance and trusted publishing enabled.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution and release flow, and
[SECURITY.md](SECURITY.md) for reporting vulnerabilities.
