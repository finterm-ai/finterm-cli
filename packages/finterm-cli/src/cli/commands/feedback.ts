/**
 * `finterm feedback` - Report a bug, ask a question, or request a feature.
 *
 * Posts to the authenticated `POST /api/v1/feedback` endpoint (works without a
 * Pro subscription). The full payload is always shown before sending, and the
 * global `--dry-run` previews it without sending — the transparency half of
 * the agent consent flow (`finterm shortcut report-feedback`).
 */
import { readFile } from 'node:fs/promises';

import { Command, InvalidArgumentError } from 'commander';

import type {
  FeedbackContext,
  FeedbackKind,
  FeedbackSubmission,
  FintermAPIClient,
} from '../../lib/api-client.js';
import { getAuthenticatedClient } from '../lib/authenticated-client.js';
import { BaseCommand } from '../lib/base-command.js';
import { CLIError, ValidationError } from '../lib/errors.js';
import { pickLastRequestForFeedback, type RecentRequestEntry } from '../lib/recent-requests.js';
import { VERSION } from '../lib/version.js';
import {
  apiCallToFintermWireResult,
  createApiOutputFormatOption,
  getRequestedApiOutputFormat,
  hasRequestedApiOutputFormat,
  isFintermWireErrorResult,
  printFintermWireResult,
  renderFintermWireResult,
  type ApiOutputOptions,
  type FintermWireResult,
} from '../lib/wire-result.js';

/** Wire caps mirrored from the server contract (kept small and client-checked). */
export const MAX_FEEDBACK_SUMMARY_LENGTH = 200;
export const MAX_FEEDBACK_BODY_LENGTH = 16 * 1024;
export const MAX_FEEDBACK_REQUEST_IDS = 8;

/** The ack schema id, used to synthesize mock-mode envelopes. */
const FEEDBACK_ACK_SCHEMA = 'finterm.result:FeedbackAck/v1';

/**
 * Obvious credential shapes that must never leave the machine in a feedback
 * body: Finterm CLI tokens, `sk-`-style provider keys, bearer headers, and AWS
 * access key ids. A light client-side guard, not a scanner — the payload
 * preview remains the real review step.
 */
const SECRET_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'a Finterm API token (fint_auth_...)', pattern: /fint_auth_[A-Za-z0-9]{8,}/ },
  { label: 'an sk-... style API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { label: 'an Authorization: Bearer header value', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { label: 'an AWS access key id (AKIA...)', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
];

/**
 * Return the human label of the first secret-shaped match in `text`, or null
 * when it looks clean.
 */
export function findSecretLikeContent(text: string): string | null {
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return label;
    }
  }
  return null;
}

/** Options shared by all `finterm feedback` subcommands. */
export interface FeedbackCommandOptions extends ApiOutputOptions {
  body?: string;
  bodyFile?: string;
  command?: string;
  tool?: string;
  errorCode?: string;
  requestId?: string[];
  /** Presence flag: Commander sets `true` when `--last` was passed, else omits the key. */
  last?: true;
}

/**
 * Merge `--last` context (the most recent failed API call from the local
 * recent-requests ledger, else the most recent call) under the caller's
 * explicit flags — anything typed out always wins. The merged result still
 * flows through the payload preview and consent flow before sending.
 */
export function mergeLastRequestContext(
  options: FeedbackCommandOptions,
  last: RecentRequestEntry
): FeedbackCommandOptions {
  const requestIds = options.requestId ?? [];
  return {
    ...options,
    command: options.command ?? last.command,
    tool: options.tool ?? last.tool,
    ...(options.errorCode === undefined && last.errorCode !== undefined
      ? { errorCode: last.errorCode }
      : {}),
    ...(last.requestId !== undefined && !requestIds.includes(last.requestId)
      ? { requestId: [...requestIds, last.requestId] }
      : {}),
  };
}

/** Commander argument parser: enforce the summary cap before any network call. */
export function parseFeedbackSummary(value: string): string {
  const summary = value.trim();
  if (summary.length === 0) {
    throw new InvalidArgumentError('Summary must not be empty.');
  }
  if (summary.length > MAX_FEEDBACK_SUMMARY_LENGTH) {
    throw new InvalidArgumentError(
      `Summary is ${summary.length} characters; the limit is ${MAX_FEEDBACK_SUMMARY_LENGTH}. Move detail into --body.`
    );
  }
  return summary;
}

/** Commander repeatable-option collector for `--request-id`. */
function collectRequestId(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Resolve the body text from `--body`, `--body-file <path>`, or `--body-file -`
 * (stdin). Returns undefined when no body was supplied.
 */
export async function resolveFeedbackBody(
  options: Pick<FeedbackCommandOptions, 'body' | 'bodyFile'>,
  readStdin: () => Promise<string> = readAllStdin
): Promise<string | undefined> {
  if (options.body !== undefined && options.bodyFile !== undefined) {
    throw new ValidationError('Use either --body or --body-file, not both.');
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    body = options.body;
  } else if (options.bodyFile === '-') {
    body = await readStdin();
  } else if (options.bodyFile !== undefined) {
    try {
      body = await readFile(options.bodyFile, 'utf-8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CLIError(`Could not read --body-file ${options.bodyFile}: ${reason}`);
    }
  }
  if (body === undefined) {
    return undefined;
  }
  if (body.length > MAX_FEEDBACK_BODY_LENGTH) {
    throw new ValidationError(
      `Body is ${body.length} characters; the limit is ${MAX_FEEDBACK_BODY_LENGTH} (16 KB). Trim it to the relevant detail.`
    );
  }
  return body;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Build the exact submission the CLI will send: the caller's explicit context
 * flags plus the only two auto-filled fields, `cli_version` and `platform`.
 * Everything here is shown in the payload preview before sending.
 */
export function buildFeedbackSubmission(params: {
  kind: FeedbackKind;
  summary: string;
  body?: string;
  options: Pick<FeedbackCommandOptions, 'command' | 'tool' | 'errorCode' | 'requestId'>;
  cliVersion?: string;
  platform?: string;
}): FeedbackSubmission {
  const requestIds = params.options.requestId ?? [];
  if (requestIds.length > MAX_FEEDBACK_REQUEST_IDS) {
    throw new ValidationError(
      `At most ${MAX_FEEDBACK_REQUEST_IDS} --request-id values are accepted; got ${requestIds.length}.`
    );
  }
  const context: FeedbackContext = {
    cli_version: params.cliVersion ?? VERSION,
    platform: params.platform ?? `${process.platform}-${process.arch}`,
  };
  if (params.options.command !== undefined) {
    context.command = params.options.command;
  }
  if (params.options.tool !== undefined) {
    context.tool_id = params.options.tool;
  }
  if (params.options.errorCode !== undefined) {
    context.error_code = params.options.errorCode;
  }
  if (requestIds.length > 0) {
    context.request_ids = requestIds;
  }
  const submission: FeedbackSubmission = {
    kind: params.kind,
    summary: params.summary,
    context,
  };
  if (params.body !== undefined) {
    submission.body = params.body;
  }
  return submission;
}

/**
 * Scrub the outbound text for obvious secrets. Throws with a pointed message
 * rather than sending — a feedback report must never carry credentials.
 */
export function assertNoSecretLikeContent(submission: FeedbackSubmission): void {
  for (const [field, text] of [
    ['summary', submission.summary],
    ['body', submission.body ?? ''],
  ] as const) {
    const match = findSecretLikeContent(text);
    if (match) {
      throw new ValidationError(
        `The feedback ${field} appears to contain ${match}. Remove the secret and resubmit.`
      );
    }
  }
}

/** Executes a feedback submission: preview, optional dry-run stop, send, render. */
class FeedbackHandler extends BaseCommand {
  async run(kind: FeedbackKind, summary: string, options: FeedbackCommandOptions): Promise<void> {
    let effectiveOptions = options;
    if (options.last) {
      const last = await pickLastRequestForFeedback();
      if (!last) {
        throw new CLIError(
          'No recent API calls are recorded locally, so --last has nothing to attach. Pass --command/--request-id explicitly instead.'
        );
      }
      effectiveOptions = mergeLastRequestContext(options, last);
    }
    const body = await resolveFeedbackBody(effectiveOptions);
    const submission = buildFeedbackSubmission({ kind, summary, body, options: effectiveOptions });
    assertNoSecretLikeContent(submission);

    // The payload preview is the transparency half of the consent flow: what
    // is shown here is byte-for-byte what will be sent. stderr, so stdout
    // stays clean for the wire result.
    const payloadJson = JSON.stringify(submission, null, 2);
    if (this.ctx.dryRun) {
      this.output.dryRun('feedback submit', { payload: submission });
      if (!this.ctx.json) {
        console.log(payloadJson);
      }
      return;
    }
    if (!this.ctx.quiet) {
      if (this.ctx.json) {
        console.error(JSON.stringify({ feedbackPayload: submission }));
      } else {
        console.error('Sending feedback payload:');
        console.error(payloadJson);
      }
    }

    const client: FintermAPIClient = await getAuthenticatedClient(this.requestLogger());
    const wireResult = await this.execute(
      () =>
        apiCallToFintermWireResult(() => client.submitFeedback(submission), {
          schema: FEEDBACK_ACK_SCHEMA,
          tool: 'feedback',
          args: { kind },
        }),
      'Failed to submit feedback'
    );

    if (isFintermWireErrorResult(wireResult)) {
      await printFintermWireResult(this.ctx, this.output, wireResult, options);
      return;
    }
    this.renderAck(wireResult, options);
  }

  /** Machine formats keep the wire envelope; human mode gets a one-line ack. */
  private renderAck(wireResult: FintermWireResult<unknown>, options: ApiOutputOptions): void {
    this.output.data(wireResult, () => {
      if (hasRequestedApiOutputFormat(this.ctx, options)) {
        console.log(
          renderFintermWireResult(wireResult, getRequestedApiOutputFormat(this.ctx, options))
        );
        return;
      }
      const feedbackId =
        'data' in wireResult &&
        typeof wireResult.data === 'object' &&
        wireResult.data !== null &&
        'feedback_id' in wireResult.data
          ? String(wireResult.data.feedback_id)
          : null;
      this.output.success(
        feedbackId
          ? `Feedback submitted (${feedbackId}). Thank you!`
          : 'Feedback submitted. Thank you!'
      );
    });
  }
}

/** Shared option wiring for the three subcommands. */
function feedbackSubcommand(name: string, description: string, kind: FeedbackKind): Command {
  return new Command(name)
    .description(description)
    .argument(
      '<summary>',
      `One-line summary (at most ${MAX_FEEDBACK_SUMMARY_LENGTH} chars)`,
      parseFeedbackSummary
    )
    .option('--body <text>', 'Longer Markdown detail')
    .option('--body-file <path>', 'Read the body from a file, or "-" for stdin')
    .option('--command <command>', 'The command line that hit the issue')
    .option('--tool <toolId>', 'The tool id involved (e.g. sec_filings_search)')
    .option('--error-code <code>', 'The error code received (e.g. RATE_LIMITED)')
    .option(
      '--request-id <id>',
      `A request_id from an affected response (repeatable, up to ${MAX_FEEDBACK_REQUEST_IDS})`,
      collectRequestId,
      []
    )
    .option(
      '--last',
      'Attach context from the most recent recorded API call (prefers the last failed one); explicit flags win'
    )
    .addOption(createApiOutputFormatOption())
    .action(async (summary: string, options: FeedbackCommandOptions, command: Command) => {
      const handler = new FeedbackHandler(command);
      await handler.run(kind, summary, options);
    });
}

/** Top-level `feedback` command grouping the bug/question/feature-request reports. */
export const feedbackCommand = new Command('feedback')
  .description('Report a bug, ask a question, or request a feature (sent to the Finterm team)')
  .addCommand(
    feedbackSubcommand(
      'bug',
      'Report a bug: something errored, looks wrong, or behaved unexpectedly',
      'bug'
    )
  )
  .addCommand(feedbackSubcommand('question', 'Ask the Finterm team a question', 'question'))
  .addCommand(
    feedbackSubcommand(
      'feature-request',
      'Request a feature or capability Finterm is missing',
      'feature_request'
    ).alias('feature')
  );
