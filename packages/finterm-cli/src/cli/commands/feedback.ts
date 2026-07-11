/**
 * `finterm feedback` - Report a bug, ask a question, or request a feature.
 *
 * Posts to the authenticated `POST /api/v1/feedback` endpoint (works without a
 * Pro subscription). The full payload is always shown before sending — on
 * every mode, including `--quiet` — and the global `--dry-run` previews it
 * without sending: the transparency half of the agent consent flow
 * (`finterm shortcut report-feedback`).
 */
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { Command, InvalidArgumentError } from 'commander';

import type {
  FeedbackAckData,
  FeedbackContext,
  FeedbackKind,
  FeedbackSubmission,
  FintermAPIClient,
} from '../../lib/api-client.js';
import { getAuthenticatedClient } from '../lib/authenticated-client.js';
import { BaseCommand } from '../lib/base-command.js';
import { CLIError, ValidationError } from '../lib/errors.js';
import { pickLastRequestForFeedback, type RecentRequestEntry } from '../lib/recent-requests.js';
import { findSecretLikeContent } from '../lib/secret-scrub.js';
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

export { findSecretLikeContent } from '../lib/secret-scrub.js';

/** Wire caps mirrored from the server contract (kept small and client-checked). */
export const MAX_FEEDBACK_SUMMARY_LENGTH = 200;
export const MAX_FEEDBACK_BODY_BYTES = 16 * 1024;
export const MAX_FEEDBACK_REQUEST_IDS = 8;
export const MAX_FEEDBACK_CONTEXT_FIELD_LENGTH = 400;
export const MAX_FEEDBACK_REQUEST_ID_LENGTH = 64;

/** The ack schema id the server must echo (`finterm.result:FeedbackAck/v1`). */
const FEEDBACK_ACK_SCHEMA = 'finterm.result:FeedbackAck/v1';

/** Control characters (including CR/LF) that a one-line summary must not carry. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

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

/** Commander argument parser: enforce the summary contract before any network call. */
export function parseFeedbackSummary(value: string): string {
  const summary = value.trim();
  if (summary.length === 0) {
    throw new InvalidArgumentError('Summary must not be empty.');
  }
  if (CONTROL_CHARS.test(summary)) {
    throw new InvalidArgumentError(
      'Summary must be a single line without control characters. Move detail into --body.'
    );
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
 *
 * The size contract is UTF-8 BYTES ({@link MAX_FEEDBACK_BODY_BYTES}), checked
 * BEFORE unbounded reads: regular files are stat-ed first, and stdin is
 * accumulated incrementally and aborted the moment it exceeds the limit.
 */
export async function resolveFeedbackBody(
  options: Pick<FeedbackCommandOptions, 'body' | 'bodyFile'>,
  readStdin: () => Promise<string> = readBoundedStdin
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
      const info = await stat(options.bodyFile);
      if (!info.isFile()) {
        throw new ValidationError(`--body-file ${options.bodyFile} is not a regular file.`);
      }
      if (info.size > MAX_FEEDBACK_BODY_BYTES) {
        throw bodyTooLargeError(info.size);
      }
      body = await readFile(options.bodyFile, 'utf-8');
    } catch (error) {
      if (error instanceof CLIError) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new CLIError(`Could not read --body-file ${options.bodyFile}: ${reason}`);
    }
  }
  // An explicitly blank body (`--body ""`, an empty file) means "no body":
  // sending `body: ""` is never what the caller intended (QA finding).
  if (body === undefined || body.trim().length === 0) {
    return undefined;
  }
  if (Buffer.byteLength(body, 'utf-8') > MAX_FEEDBACK_BODY_BYTES) {
    throw bodyTooLargeError(Buffer.byteLength(body, 'utf-8'));
  }
  return body;
}

function bodyTooLargeError(sizeBytes: number): ValidationError {
  return new ValidationError(
    `Body is ${sizeBytes} bytes; the limit is ${MAX_FEEDBACK_BODY_BYTES} bytes (16 KiB UTF-8). Trim it to the relevant detail.`
  );
}

/** Read stdin, aborting as soon as the byte limit is exceeded (never buffers a flood). */
async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_FEEDBACK_BODY_BYTES) {
      process.stdin.destroy();
      throw bodyTooLargeError(totalBytes);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Build the exact submission the CLI will send: the caller's explicit context
 * flags plus the auto-filled `cli_version`, `platform`, and the per-invocation
 * idempotency `submission_id`. Everything here is shown in the payload preview
 * before sending.
 */
export function buildFeedbackSubmission(params: {
  kind: FeedbackKind;
  summary: string;
  body?: string;
  options: Pick<FeedbackCommandOptions, 'command' | 'tool' | 'errorCode' | 'requestId'>;
  cliVersion?: string;
  platform?: string;
  submissionId?: string;
}): FeedbackSubmission {
  const requestIds = params.options.requestId ?? [];
  if (requestIds.length > MAX_FEEDBACK_REQUEST_IDS) {
    throw new ValidationError(
      `At most ${MAX_FEEDBACK_REQUEST_IDS} --request-id values are accepted; got ${requestIds.length}.`
    );
  }
  for (const id of requestIds) {
    if (id.length === 0 || id.length > MAX_FEEDBACK_REQUEST_ID_LENGTH) {
      throw new ValidationError(
        `Request ids must be 1-${MAX_FEEDBACK_REQUEST_ID_LENGTH} characters; got "${id.slice(0, 80)}".`
      );
    }
  }
  const context: FeedbackContext = {
    cli_version: params.cliVersion ?? VERSION,
    platform: params.platform ?? `${process.platform}-${process.arch}`,
  };
  if (params.options.command !== undefined) {
    context.command = boundedContextField('command', params.options.command);
  }
  if (params.options.tool !== undefined) {
    context.tool_id = boundedContextField('tool', params.options.tool);
  }
  if (params.options.errorCode !== undefined) {
    context.error_code = boundedContextField('error-code', params.options.errorCode);
  }
  if (requestIds.length > 0) {
    context.request_ids = requestIds;
  }
  const submission: FeedbackSubmission = {
    kind: params.kind,
    summary: params.summary,
    submission_id: params.submissionId ?? randomUUID(),
    context,
  };
  if (params.body !== undefined) {
    submission.body = params.body;
  }
  return submission;
}

/** Enforce the per-field context cap client-side, naming the offending flag. */
function boundedContextField(flag: string, value: string): string {
  if (value.length === 0 || value.length > MAX_FEEDBACK_CONTEXT_FIELD_LENGTH) {
    throw new ValidationError(
      `--${flag} must be 1-${MAX_FEEDBACK_CONTEXT_FIELD_LENGTH} characters; got ${value.length}.`
    );
  }
  return value;
}

/**
 * Scrub every outbound string — summary, body, and each context field
 * (including anything `--last` merged in) — for obvious secrets. Throws with a
 * pointed message rather than sending — a feedback report must never carry
 * credentials.
 */
export function assertNoSecretLikeContent(submission: FeedbackSubmission): void {
  const fields: [string, string][] = [
    ['summary', submission.summary],
    ['body', submission.body ?? ''],
  ];
  const context = submission.context ?? {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string') {
      fields.push([`context.${key}`, value]);
    } else if (Array.isArray(value)) {
      fields.push([`context.${key}`, value.join(' ')]);
    }
  }
  for (const [field, text] of fields) {
    const match = findSecretLikeContent(text);
    if (match) {
      throw new ValidationError(
        `The feedback ${field} appears to contain ${match}. Remove the secret and resubmit.`
      );
    }
  }
}

/**
 * Validate the server's 200 response against the exact ack contract. A 200
 * with the wrong schema/tool, a missing feedback id, or a status other than
 * "received" is a contract error, never a success.
 */
export function parseFeedbackAck(wireResult: FintermWireResult<unknown>): FeedbackAckData {
  const contractError = (detail: string): CLIError =>
    new CLIError(`The server response did not match the feedback acknowledgement: ${detail}`, {
      code: 'FEEDBACK_ACK_MALFORMED',
    });
  if (!('data' in wireResult)) {
    throw contractError('no data payload');
  }
  if (wireResult.finterm.schema !== FEEDBACK_ACK_SCHEMA || wireResult.finterm.tool !== 'feedback') {
    throw contractError(`unexpected schema/tool ${wireResult.finterm.schema}`);
  }
  const data = wireResult.data;
  if (typeof data !== 'object' || data === null) {
    throw contractError('non-object data payload');
  }
  const ack = data as Record<string, unknown>;
  if (typeof ack.feedback_id !== 'string' || ack.feedback_id.length === 0) {
    throw contractError('missing feedback_id');
  }
  if (ack.status !== 'received') {
    throw contractError(`unexpected status "${String(ack.status)}"`);
  }
  return { feedback_id: ack.feedback_id, status: 'received' };
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
    // stays clean for the wire result. DELIBERATELY unsuppressible — a real
    // submission always discloses its payload, `--quiet` included.
    const payloadJson = JSON.stringify(submission, null, 2);
    if (this.ctx.dryRun) {
      this.output.dryRun('feedback submit', { payload: submission });
      if (!this.ctx.json) {
        console.log(payloadJson);
      }
      return;
    }
    if (this.ctx.json) {
      console.error(JSON.stringify({ feedbackPayload: submission }));
    } else {
      console.error('Sending feedback payload:');
      console.error(payloadJson);
    }

    const client: FintermAPIClient = await getAuthenticatedClient(this.requestLogger());
    const wireResult = await this.execute(
      () =>
        apiCallToFintermWireResult(() => client.submitFeedback(submission), {
          schema: FEEDBACK_ACK_SCHEMA,
          tool: 'feedback',
          args: {},
        }),
      'Failed to submit feedback'
    );

    if (isFintermWireErrorResult(wireResult)) {
      await printFintermWireResult(this.ctx, this.output, wireResult, options);
      return;
    }
    const ack = parseFeedbackAck(wireResult);
    this.renderAck(wireResult, ack, options);
  }

  /** Machine formats keep the wire envelope; human mode gets a one-line ack. */
  private renderAck(
    wireResult: FintermWireResult<unknown>,
    ack: FeedbackAckData,
    options: ApiOutputOptions
  ): void {
    this.output.data(wireResult, () => {
      if (hasRequestedApiOutputFormat(this.ctx, options)) {
        console.log(
          renderFintermWireResult(wireResult, getRequestedApiOutputFormat(this.ctx, options))
        );
        return;
      }
      this.output.success(`Feedback submitted (${ack.feedback_id}). Thank you!`);
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
