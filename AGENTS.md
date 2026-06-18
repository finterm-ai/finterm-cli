# Finterm CLI

This repository contains the public `finterm` npm package and `finterm` command.
It is a client for Finterm APIs and local Dataroom reading.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint:check
pnpm build
pnpm test
pnpm publint
pnpm --filter finterm test:pack
pnpm public:check
```

## Rules

- Do not publish from an agent session.
  npm publication requires explicit human approval and release setup.
- Keep the package boundary public-only:
  no internal engine code, provider clients, private tool-definition files, unpublished API
  docs, or native Dataroom database adapters.
- Keep the first release to one public npm package named `finterm` and one binary named
  `finterm`.
- Use `contact@finterm.ai` for public support and security contacts.
- Install dependencies with `pnpm install --frozen-lockfile`.
  The project `.npmrc` enforces a 14-day package release-age gate.

<!-- This document follows common-doc-guidelines.md.
See github.com/jlevy/practical-prose and review guidelines before editing.
-->
