import { defineConfig } from 'tsdown';

// Import git version detection from shared script (not distributed with package)
import { getGitVersion } from './scripts/git-version.mjs';

const version = getGitVersion();

// Common options for ESM-only build
const commonOptions = {
  format: ['esm'] as 'esm'[],
  platform: 'node' as const,
  target: 'node22' as const,
  sourcemap: false,
  dts: true,
  define: {
    __FINTERM_VERSION__: JSON.stringify(version),
  },
};

// Workspace packages must be bundled into EVERY entry: they are private/unpublished
// (a published manifest can't depend on them) and some export raw TS source that a
// plain-node consumer can't load. Regexes, not bare package-name strings: bare
// strings do not match subpath imports ('dataroom/file-profile') in this tsdown
// version — the leak the post-build no-leak guard (scripts/check-bundle-leaks.mjs)
// now pins.
const workspaceNoExternal = [/^dataroom(\/|$)/, /^@finterm\/dataroom-cli(\/|$)/];

export default defineConfig([
  // Library entry points
  {
    ...commonOptions,
    entry: {
      index: 'src/index.ts',
      cli: 'src/cli/cli.ts',
    },
    clean: true,
    inlineOnly: false, // Suppress warning - transitive deps bundled intentionally
    noExternal: workspaceNoExternal,
  },
  // CLI binary - ESM entry (used by bootstrap)
  // Bundle all dependencies for faster startup (no node_modules resolution at runtime)
  {
    ...commonOptions,
    entry: { bin: 'src/cli/bin.ts' },
    banner: '#!/usr/bin/env node',
    clean: false,
    inlineOnly: false, // Suppress warning - transitive deps bundled intentionally
    noExternal: [
      // The workspace packages' non-database externals are already direct dependencies
      // of this package, so bundling them adds no new runtime deps.
      ...workspaceNoExternal,
      'commander',
      'picocolors',
      'marked',
      'marked-terminal',
      'yaml',
      'atomically',
      'dotenv',
    ],
  },
  // CLI bootstrap - CJS entry that enables compile cache before loading ESM
  {
    format: ['cjs'] as 'cjs'[],
    platform: 'node' as const,
    target: 'node22' as const,
    sourcemap: false,
    dts: false,
    entry: { 'bin-bootstrap': 'src/cli/bin-bootstrap.cjs' },
    banner: '#!/usr/bin/env node',
    clean: false,
  },
]);
