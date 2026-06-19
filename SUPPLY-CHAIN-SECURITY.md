# Supply-Chain Security

Install and upgrade dependencies conservatively.

## Rules

- Use `pnpm install --frozen-lockfile`
- Do not update dependencies without reviewing the lockfile diff
- Keep the project `.npmrc` 14-day release-age gate enabled
- Do not add lifecycle-script exceptions without human review
- Do not use unpinned zero-install runners such as unversioned `npx`, `pnpm dlx`, or
  `curl | sh`

## Publishing

The package is published to npm by the maintainers, with provenance and trusted
publishing enabled.
