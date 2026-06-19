# Contributing

Contributions are welcome.
Use the normal GitHub pull request flow.

## Setup

This is a pnpm workspace requiring Node `>=22.12`. Install dependencies with the frozen
lockfile so the project `.npmrc` release-age gate stays effective:

```bash
pnpm install --frozen-lockfile
```

## Before Opening a Pull Request

Run the full check suite and make sure it passes:

```bash
pnpm ci
```

`pnpm ci` runs format, lint and typecheck, tests, build, `publint`, the packed-artifact
smoke test, and `pnpm public:check` (which guards against unpublished surface leaking
into the package).
See [AGENTS.md](AGENTS.md) for the repository layout and the published
command surface.

Keep changes focused on the CLI and its documentation, and do not commit credentials,
API keys, or other secrets.
Read [SUPPLY-CHAIN-SECURITY.md](SUPPLY-CHAIN-SECURITY.md) before adding or upgrading any
dependency.

## Releases

Maintainers publish releases to npm with provenance and trusted publishing.
Do not publish the package yourself; open a pull request instead.
