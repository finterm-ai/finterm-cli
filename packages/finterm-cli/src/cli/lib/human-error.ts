/**
 * Humanized default-mode rendering for API wire errors (funnel spec C0/C1,
 * fin-qzmc / fin-1suq).
 *
 * When no machine-readable format was requested, an API error prints as a
 * concise human block on stderr — title, message, error code, and the remedy —
 * instead of the raw `{finterm,error}` JSON envelope. `--json`/`--format`
 * callers keep the wire shape untouched.
 *
 * `SUBSCRIPTION_REQUIRED` (402) is the flagship case: the paywall block
 * renders the server's message and the upgrade URL (preferring the envelope's
 * machine-readable `upgrade_url`), then offers to open the browser when the
 * terminal is interactive. No polling loop follows: the next invocation
 * re-checks entitlement server-side by construction.
 *
 * The CLI never states offer terms (price, trial length, card requirement) —
 * those are owned by the server message and the pricing page, so offer changes
 * never require a CLI release.
 */

import { createInterface } from 'node:readline/promises';

import type { CommandContext } from './context.js';
import type { OutputManager } from './output.js';
import { ICONS } from './output.js';

/** Fallback when a 402 envelope predates the machine-readable field. */
export const UPGRADE_URL_FALLBACK = 'https://app.finterm.ai/pricing';

/**
 * Prefix of the synthesized error code for an HTTP failure that carried no
 * `{finterm,error}` envelope (a gateway 5xx, an HTML body); the renderer keys
 * on it to distinguish a service fault from bad input (fin-27bn).
 */
export const UPSTREAM_HTTP_CODE_PREFIX = 'UPSTREAM_HTTP_';

/** Post-checkout pointer: access resumes without any CLI-side re-auth. */
export const RESUME_LINE = 'After checkout, re-run this command — access resumes automatically.';

/**
 * One-active-key-per-account explanation for 401s on a previously working
 * credential (funnel spec C3): a login on another machine or a dashboard
 * regenerate revokes every other copy.
 */
export const KEY_ROTATION_LINE =
  'Finterm keeps one active API key per account: logging in on another machine or ' +
  'regenerating the key in the dashboard revokes this one.';

/**
 * In-product report affordance on service-fault errors (the user feedback
 * loop): the moment something looks broken is exactly when a report is
 * cheapest to file and most useful to receive.
 */
export const REPORT_FEEDBACK_LINE =
  'If this looks wrong, report it: `finterm feedback bug "<summary>" --request-id <id>` ' +
  '(the request id is in the error envelope).';

/** The wire error fields the human renderer consumes. */
export interface WireErrorLike {
  code: string;
  message: string;
  upgrade_url?: string;
}

interface HumanErrorShape {
  title: string;
  /** Extra remedy/context lines rendered after the message. */
  remedy: string[];
}

function shapeFor(error: WireErrorLike): HumanErrorShape {
  // A gateway 502 must stop reading like a problem with the user's input:
  // say whether this looks like a service fault or a rejected request.
  if (error.code.startsWith(UPSTREAM_HTTP_CODE_PREFIX)) {
    const status = Number(error.code.slice(UPSTREAM_HTTP_CODE_PREFIX.length));
    return {
      title: `Finterm API request failed (HTTP ${status})`,
      remedy:
        status >= 500
          ? [
              'This looks like a service-side fault, not a problem with your input. Try again shortly; if it persists, contact contact@finterm.ai.',
              REPORT_FEEDBACK_LINE,
            ]
          : [
              'The request was rejected upstream without details. Double-check your inputs; if this persists, contact contact@finterm.ai.',
            ],
    };
  }
  switch (error.code) {
    case 'SUBSCRIPTION_REQUIRED':
      return {
        title: 'Finterm Pro required',
        remedy: ['', `Upgrade: ${error.upgrade_url ?? UPGRADE_URL_FALLBACK}`, '', RESUME_LINE],
      };
    case 'TOKEN_MISSING':
      return {
        title: 'Not authenticated',
        remedy: [
          'Run `finterm auth login` to authenticate (or set FINTERM_API_KEY to a key from your dashboard).',
        ],
      };
    case 'TOKEN_INVALID':
    case 'TOKEN_EXPIRED':
    case 'TOKEN_REVOKED':
      return {
        title: 'Not authenticated',
        remedy: [KEY_ROTATION_LINE, 'Run `finterm auth login` to re-authenticate.'],
      };
    case 'RATE_LIMITED':
      return {
        title: 'Rate limited',
        remedy: ['You are sending requests too quickly — wait a moment and retry.'],
      };
    case 'RUNTIME_UNAVAILABLE':
    case 'RUNTIME_AUTH_REJECTED':
    case 'RUNTIME_ERROR':
      return {
        title: 'Data runtime unavailable',
        remedy: [
          'The Finterm data runtime could not serve this request. Try again shortly; if it persists, contact contact@finterm.ai.',
          REPORT_FEEDBACK_LINE,
        ],
      };
    case 'VALIDATION_ERROR':
    case 'INVALID_JSON':
      return { title: 'Invalid request', remedy: [] };
    default:
      // Every service-fault class (any other RUNTIME_* code, upstream tool
      // failures) carries the report affordance: not the caller's fault.
      if (error.code.startsWith('RUNTIME_') || error.code === 'TOOL_EXECUTION_FAILED') {
        return { title: 'Request failed', remedy: [REPORT_FEEDBACK_LINE] };
      }
      return { title: 'Request failed', remedy: [] };
  }
}

/**
 * Build the human error block as unstyled lines (exported for tests; the
 * printer applies color).
 */
export function humanWireErrorLines(error: WireErrorLike): string[] {
  const shape = shapeFor(error);
  const lines = [`${ICONS.ERROR} ${shape.title}`, `  ${error.message}`, `  (code: ${error.code})`];
  for (const remedy of shape.remedy) {
    lines.push(remedy === '' ? '' : `  ${remedy}`);
  }
  return lines;
}

/**
 * Whether the paywall may offer to open a browser: a human at an interactive
 * terminal who did not opt out. Agents and CI (no TTY, `--non-interactive`,
 * machine formats) never get prompted.
 */
function canPromptForBrowser(ctx: CommandContext): boolean {
  return (
    process.stdin.isTTY === true &&
    process.stderr.isTTY === true &&
    !ctx.nonInteractive &&
    !ctx.json &&
    !ctx.quiet
  );
}

/** Minimal y/N confirm on stderr, so stdout stays clean for data. */
async function confirmOnStderr(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Print a wire error as the human block on stderr, and — for the 402 paywall
 * in an interactive terminal — offer to open the upgrade page in the browser
 * (reusing the device-flow open). The caller keeps ownership of the exit code.
 */
export async function printHumanWireError(
  ctx: CommandContext,
  output: OutputManager,
  error: WireErrorLike
): Promise<void> {
  const colors = output.getColors();
  const [title = '', ...rest] = humanWireErrorLines(error);
  console.error(colors.error(title));
  for (const line of rest) {
    console.error(line.startsWith('  (code:') ? colors.dim(line) : line);
  }

  if (error.code === 'SUBSCRIPTION_REQUIRED' && canPromptForBrowser(ctx)) {
    const upgradeUrl = error.upgrade_url ?? UPGRADE_URL_FALLBACK;
    const yes = await confirmOnStderr('\nOpen the upgrade page in your browser now? [y/N] ');
    if (yes) {
      try {
        // Lazy load to keep the common CLI startup chunk free of browser-opening
        // code (same pattern as the device-flow login).
        const { default: open } = await import('open');
        await open(upgradeUrl);
        console.error(`Opened ${upgradeUrl}`);
      } catch {
        console.error(`Could not open the browser automatically. Upgrade at: ${upgradeUrl}`);
      }
    }
  }
}
