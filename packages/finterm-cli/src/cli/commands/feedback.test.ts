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
  MAX_FEEDBACK_BODY_LENGTH,
  MAX_FEEDBACK_REQUEST_IDS,
  MAX_FEEDBACK_SUMMARY_LENGTH,
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

  it('is registered on the root program under Feedback & Support', () => {
    const program = createProgram();
    expect(program.commands.map((cmd) => cmd.name())).toContain('feedback');
    const help = program.helpInformation();
    expect(help).toContain('Feedback & Support:');
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

  it('rejects a body over 16 KB', async () => {
    await expect(
      resolveFeedbackBody({ body: 'x'.repeat(MAX_FEEDBACK_BODY_LENGTH + 1) })
    ).rejects.toThrow(/16 KB/);
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
    });
    expect(submission).toEqual({
      kind: 'bug',
      summary: 'It broke',
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
        body: 'here is fint_auth_abcdefghij1234567890',
      });
    }).toThrow(/body/);
    expect(() => {
      assertNoSecretLikeContent({ kind: 'bug', summary: 'clean', body: 'also clean' });
    }).not.toThrow();
  });
});
