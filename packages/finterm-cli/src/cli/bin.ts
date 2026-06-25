/**
 * CLI binary entry point.
 * This file should be minimal - just imports and runs the CLI.
 */

// Handle EPIPE gracefully when output is piped to commands like `head` or when
// a pager closes. Both stdout and stderr can receive EPIPE. Exit code 0 is
// standard — a closed pipe is intentional user action, not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
});
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
});

// Bootstrap proxy support for Node.js native fetch.
// Node.js fetch does not honor HTTP_PROXY/HTTPS_PROXY env vars by default
// (NODE_USE_ENV_PROXY requires Node 23+). Use undici's ProxyAgent when available.
import { getGlobalDispatcher } from 'undici';

import { bootstrapProxy } from '../lib/proxy-bootstrap.js';
import { runCli } from './cli.js';

async function closeFetchDispatcher(): Promise<void> {
  await getGlobalDispatcher()
    .close()
    .catch(() => undefined);
}

async function main(): Promise<void> {
  await bootstrapProxy();
  try {
    await runCli();
  } finally {
    await closeFetchDispatcher();
  }
}

void main().catch((error: unknown) => {
  // Bootstrap failures (e.g. an invalid proxy configuration) happen before the
  // CLI's own error handling is in place. Print a clean one-line message
  // instead of dumping a raw stack trace.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`finterm: ${message}`);
  process.exit(1);
});
