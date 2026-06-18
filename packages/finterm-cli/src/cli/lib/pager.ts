/**
 * Pager support for long output.
 *
 * Pipes content through the user's `$PAGER` (default `less -R`) when stdout is
 * an interactive TTY; prints directly otherwise (pipes, CI, agents). A missing
 * or failing pager falls back to direct output, never an error.
 */

import { spawn } from 'node:child_process';

/** Default pager: `-R` keeps ANSI colors intact. */
const DEFAULT_PAGER = 'less -R';

/**
 * Split a PAGER value into command + args (whitespace-separated; PAGER values
 * with quoted arguments are not supported, matching git's simple handling).
 */
export function parsePagerCommand(pagerValue: string | undefined): {
  command: string;
  args: string[];
} {
  const value = pagerValue?.trim() ? pagerValue.trim() : DEFAULT_PAGER;
  const [command, ...args] = value.split(/\s+/);
  return { command: command!, args };
}

/**
 * Show content in the pager if interactive, else print it.
 */
export async function showInPager(content: string): Promise<void> {
  if (!process.stdout.isTTY) {
    // Not interactive, just print
    console.log(content);
    return;
  }

  const { command, args } = parsePagerCommand(process.env.PAGER);

  return new Promise((resolve) => {
    const pager = spawn(command, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    pager.on('error', () => {
      // Pager not available, fall back to direct output
      console.log(content);
      resolve();
    });

    pager.on('close', () => {
      resolve();
    });

    pager.stdin.write(content);
    pager.stdin.end();
  });
}
