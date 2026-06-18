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

- The package ships one npm package named `finterm` and one binary named `finterm`.
- Use `contact@finterm.ai` for public support and security contacts.
- Install dependencies with `pnpm install --frozen-lockfile`. The project `.npmrc`
  enforces a 14-day package release-age gate.
- Run the full check suite before opening a pull request (see `pnpm ci`).
