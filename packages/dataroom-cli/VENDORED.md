# Vendored package — do not edit `src/`

The `src/` tree of this package is vendored byte-identical from its canonical home in
the private upstream monorepo and is verified by `pnpm dataroom:check` against
`vendor-manifest.json`. Local edits will fail CI.

Make changes upstream, then re-sync: see [docs/VENDORING.md](../../docs/VENDORING.md).
