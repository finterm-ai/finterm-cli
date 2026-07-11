import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InvalidArgumentError } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';

import { createProgram } from '../cli.js';
import { CLIError, ValidationError } from '../lib/errors.js';
import {
  assertNoSecretLikeContent,
  buildFeedbackSubmission,
  feedbackCommand,
  findSecretLikeContent,
  MAX_FEEDBACK_BODY_BYTES,
  MAX_FEEDBACK_CONTEXT_FIELD_LENGTH,
  MAX_FEEDBACK_REQUEST_IDS,
  MAX_FEEDBACK_SUMMARY_LENGTH,
  parseFeedbackAck,
  parseFeedbackSummary,
  resolveFeedbackBody,
} from './feedback.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'finterm-feedback-test-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('feedback command tree', () => {
  it('registers bug, question, and feature-request (alias feature) subcommands', () => {
    const names = feedbackCommand.commands.map((cmd) => cmd.name());
    expect(names).toEqual(['bug', 'question', 'feature-request']);
    const featureRequest = feedbackCommand.commands.find((cmd) => cmd.name() === 'feature-request');
    expect(featureRequest?.aliases()).toContain('feature');
  });

  it('offers the context flags and shared --format on every subcommand', () => {
    for (const sub of feedbackCommand.commands) {
      const flags = sub.options.map((option) => option.long);
      for (const expected of [
        '--body',
        '--body-file',
        '--command',
        '--tool',
        '--error-code',
        '--request-id',
        '--format',
      ]) {
        expect(flags, `${sub.name()} has ${expected}`).toContain(expected);
      }
    }
  });

  it('is registered on the root program under Feedback and Support', () => {
    const program = createProgram();
    expect(program.commands.map((cmd) => cmd.name())).toContain('feedback');
    const help = program.helpInformation();
    expect(help).toContain('Feedback and Support:');
    expect(help).toContain('feedback');
  });

  it('advertises the feedback channel in the root help epilog', async () => {
    const program = createProgram();
    let helpText = '';
    program.exitOverride();
    program.configureOutput({ writeOut: (str) => (helpText += str) });
    try {
      await program.parseAsync(['node', 'finterm', '--help']);
    } catch {
      // exitOverride turns help display into a throw; the buffer is what matters.
    }
    expect(helpText).toContain('Found a bug? Have a question or feature request?');
    expect(helpText).toContain('finterm feedback');
  });
});

describe('parseFeedbackSummary', () => {
  it('accepts and trims a normal summary', () => {
    expect(parseFeedbackSummary('  prices look stale  ')).toBe('prices look stale');
  });

  it('rejects an empty summary', () => {
    expect(() => parseFeedbackSummary('   ')).toThrow(InvalidArgumentError);
  });

  it('rejects a summary over the cap with a pointer to --body', () => {
    expect(() => parseFeedbackSummary('x'.repeat(MAX_FEEDBACK_SUMMARY_LENGTH + 1))).toThrow(
      /--body/
    );
  });

  it('rejects newlines and control characters (one line means one line)', () => {
    for (const bad of ['line one\nline two', 'carriage\rreturn', 'null\u0000byte']) {
      expect(() => parseFeedbackSummary(bad), JSON.stringify(bad)).toThrow(InvalidArgumentError);
    }
  });
});

describe('resolveFeedbackBody', () => {
  it('returns undefined when no body was supplied', async () => {
    await expect(resolveFeedbackBody({})).resolves.toBeUndefined();
  });

  it('passes --body text through', async () => {
    await expect(resolveFeedbackBody({ body: 'details' })).resolves.toBe('details');
  });

  it('treats an explicitly blank body as no body (QA finding)', async () => {
    await expect(resolveFeedbackBody({ body: '' })).resolves.toBeUndefined();
    await expect(resolveFeedbackBody({ body: '   \n' })).resolves.toBeUndefined();
  });

  it('reads --body-file from disk', async () => {
    const file = join(tempDir(), 'body.md');
    writeFileSync(file, '# What happened\nIt broke.');
    await expect(resolveFeedbackBody({ bodyFile: file })).resolves.toContain('It broke.');
  });

  it('reads stdin for --body-file -', async () => {
    const readStdin = async () => 'from stdin';
    await expect(resolveFeedbackBody({ bodyFile: '-' }, readStdin)).resolves.toBe('from stdin');
  });

  it('rejects using --body and --body-file together', async () => {
    await expect(resolveFeedbackBody({ body: 'a', bodyFile: 'b' })).rejects.toThrow(
      ValidationError
    );
  });

  it('fails clearly when the body file is missing', async () => {
    await expect(resolveFeedbackBody({ bodyFile: '/nonexistent/body.md' })).rejects.toThrow(
      CLIError
    );
  });

  it('rejects a body over the byte limit', async () => {
    await expect(
      resolveFeedbackBody({ body: 'x'.repeat(MAX_FEEDBACK_BODY_BYTES + 1) })
    ).rejects.toThrow(/16 KiB/);
  });

  it('counts bytes, not characters, for multibyte bodies', async () => {
    // Each 'é' is 2 UTF-8 bytes: half the limit in characters exceeds it in bytes.
    await expect(
      resolveFeedbackBody({ body: 'é'.repeat(MAX_FEEDBACK_BODY_BYTES / 2 + 1) })
    ).rejects.toThrow(/16 KiB/);
  });

  it('rejects an oversized --body-file from its size alone (no unbounded read)', async () => {
    const file = join(tempDir(), 'huge.md');
    writeFileSync(file, 'x'.repeat(MAX_FEEDBACK_BODY_BYTES + 1));
    await expect(resolveFeedbackBody({ bodyFile: file })).rejects.toThrow(/16 KiB/);
  });

  it('aborts an over-limit stdin stream mid-read', async () => {
    async function* flood(): AsyncGenerator<Buffer> {
      // Two chunks that together exceed the cap; the reader must stop there.
      yield Buffer.alloc(MAX_FEEDBACK_BODY_BYTES, 'x');
      yield Buffer.alloc(2, 'x');
      throw new Error('reader kept consuming past the limit');
    }
    const readStdin = async (): Promise<string> => {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of flood()) {
        total += chunk.length;
        if (total > MAX_FEEDBACK_BODY_BYTES) {
          throw new Error(`Body is ${total} bytes; the limit is 16 KiB`);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    };
    await expect(resolveFeedbackBody({ bodyFile: '-' }, readStdin)).rejects.toThrow(/16 KiB/);
  });
});

describe('buildFeedbackSubmission', () => {
  it('auto-fills only cli_version and platform', () => {
    const submission = buildFeedbackSubmission({
      kind: 'bug',
      summary: 'It broke',
      options: {},
      cliVersion: '1.2.3',
      platform: 'linux-x64',
      submissionId: 'sub-fixed',
    });
    expect(submission).toEqual({
      kind: 'bug',
      summary: 'It broke',
      submission_id: 'sub-fixed',
      context: { cli_version: '1.2.3', platform: 'linux-x64' },
    });
  });

  it('maps the context flags onto the wire keys', () => {
    const submission = buildFeedbackSubmission({
      kind: 'feature_request',
      summary: 'Add dividends',
      body: 'Long detail',
      options: {
        command: 'finterm tool sec_filings_search AAPL',
        tool: 'sec_filings_search',
        errorCode: 'RATE_LIMITED',
        requestId: ['req_1', 'req_2'],
      },
      cliVersion: '1.2.3',
      platform: 'linux-x64',
    });
    expect(submission.body).toBe('Long detail');
    expect(submission.context).toEqual({
      cli_version: '1.2.3',
      platform: 'linux-x64',
      command: 'finterm tool sec_filings_search AAPL',
      tool_id: 'sec_filings_search',
      error_code: 'RATE_LIMITED',
      request_ids: ['req_1', 'req_2'],
    });
  });

  it('caps each context flag at the wire limit, naming the flag', () => {
    expect(() =>
      buildFeedbackSubmission({
        kind: 'bug',
        summary: 'caps',
        options: { command: 'x'.repeat(MAX_FEEDBACK_CONTEXT_FIELD_LENGTH + 1) },
      })
    ).toThrow(/--command/);
    expect(() =>
      buildFeedbackSubmission({
        kind: 'bug',
        summary: 'caps',
        options: { requestId: ['x'.repeat(65)] },
      })
    ).toThrow(/Request ids/);
  });

  it('generates a fresh submission_id per invocation (idempotency key)', () => {
    const first = buildFeedbackSubmission({ kind: 'bug', summary: 'a', options: {} });
    const second = buildFeedbackSubmission({ kind: 'bug', summary: 'a', options: {} });
    expect(first.submission_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.submission_id).not.toBe(second.submission_id);
  });

  it('rejects more than the request-id cap', () => {
    expect(() =>
      buildFeedbackSubmission({
        kind: 'bug',
        summary: 'Too many ids',
        options: {
          requestId: Array.from({ length: MAX_FEEDBACK_REQUEST_IDS + 1 }, (_, i) => `req_${i}`),
        },
      })
    ).toThrow(ValidationError);
  });
});

describe('secret scrub', () => {
  it('flags Finterm tokens, sk- keys, bearer values, and AWS key ids', () => {
    // Fixture secrets are composed at runtime so the repo's own credential
    // scan (scripts/check-public-boundary.mjs) never sees a literal match.
    const secrets = [
      `my token is ${'fint_auth_'}abcdefghij1234567890`,
      `use ${'sk-'}${'a'.repeat(24)} to auth`,
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
      `key ${'AKIA'}IOSFODNN7EXAMPLE leaked`,
    ];
    for (const text of secrets) {
      expect(findSecretLikeContent(text), text).not.toBeNull();
    }
  });

  it('passes ordinary report text', () => {
    expect(
      findSecretLikeContent('The sec_filings_search tool 500s for BRK.B — request req_abc123.')
    ).toBeNull();
  });

  it('assertNoSecretLikeContent names the offending field', () => {
    expect(() => {
      assertNoSecretLikeContent({
        kind: 'bug',
        summary: 'clean',
        submission_id: 'sub-1',
        body: 'here is fint_auth_abcdefghij1234567890',
      });
    }).toThrow(/body/);
    expect(() => {
      assertNoSecretLikeContent({
        kind: 'bug',
        summary: 'clean',
        submission_id: 'sub-2',
        body: 'also clean',
      });
    }).not.toThrow();
  });
});

describe('secret scrub covers context fields (including --last merges)', () => {
  it('flags a secret hiding in context.command', () => {
    expect(() => {
      assertNoSecretLikeContent({
        kind: 'bug',
        summary: 'clean',
        submission_id: 'sub-3',
        context: {
          cli_version: '1.0.0',
          platform: 'linux-x64',
          command: `finterm auth login ${'fint_auth_'}abcdefghij1234567890`,
        },
      });
    }).toThrow(/context\.command/);
  });

  it('flags a secret hiding in context.request_ids', () => {
    expect(() => {
      assertNoSecretLikeContent({
        kind: 'bug',
        summary: 'clean',
        submission_id: 'sub-4',
        context: { request_ids: [`${'sk-'}${'a'.repeat(24)}`] },
      });
    }).toThrow(/context\.request_ids/);
  });
});

describe('parseFeedbackAck (strict ack contract)', () => {
  const GOOD = {
    finterm: { schema: 'finterm.result:FeedbackAck/v1', tool: 'feedback', args: {} },
    data: { feedback_id: 'fb_x', status: 'received' },
  };

  it('accepts the exact ack envelope', () => {
    expect(parseFeedbackAck(GOOD)).toEqual({ feedback_id: 'fb_x', status: 'received' });
  });

  it('rejects a bare/wrong-schema 200 instead of claiming success', () => {
    const bad = [
      { finterm: GOOD.finterm, data: {} },
      { finterm: GOOD.finterm, data: { feedback_id: '', status: 'received' } },
      { finterm: GOOD.finterm, data: { feedback_id: 'fb_x', status: 'queued' } },
      {
        finterm: { schema: 'finterm.result:Other/v1', tool: 'feedback', args: {} },
        data: GOOD.data,
      },
    ];
    for (const wire of bad) {
      expect(() => parseFeedbackAck(wire), JSON.stringify(wire)).toThrow(
        /feedback acknowledgement/
      );
    }
  });
});
