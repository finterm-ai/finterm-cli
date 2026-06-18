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

Do not publish from an agent session.
The first npm publication requires explicit human approval, npm ownership setup,
provenance/trusted publishing review, and a passing release dry run.

<!-- This document follows common-doc-guidelines.md.
See github.com/jlevy/practical-prose and review guidelines before editing.
-->
