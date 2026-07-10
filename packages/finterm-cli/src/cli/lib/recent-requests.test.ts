import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeLastRequestContext } from '../commands/feedback.js';
import {
  buildRecentRequestEntry,
  buildTransportFailureEntry,
  commandLineFromArgv,
  listRecentRequests,
  MAX_RECENT_REQUESTS,
  pickLastRequestForFeedback,
  recordRecentRequest,
  type RecentRequestEntry,
} from './recent-requests.js';

let fintermDir: string;

beforeEach(async () => {
  fintermDir = await mkdtemp(join(tmpdir(), 'finterm-recent-requests-'));
  vi.stubEnv('FINTERM_CONFIG', fintermDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(fintermDir, { recursive: true, force: true });
});

function entry(overrides: Partial<RecentRequestEntry> = {}): RecentRequestEntry {
  return {
    at: '2026-07-10T00:00:00.000Z',
    command: 'finterm tool ticker_sentiment META',
    tool: 'ticker_sentiment',
    outcome: overrides.errorCode !== undefined ? 'error' : 'ok',
    ...overrides,
  };
}

describe('recent-requests ledger', () => {
  it('round-trips record -> list, newest first', async () => {
    await recordRecentRequest(entry({ requestId: 'req_1' }));
    await recordRecentRequest(entry({ requestId: 'req_2', errorCode: 'RATE_LIMITED' }));

    const requests = await listRecentRequests();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.requestId).toBe('req_2');
    expect(requests[0]?.errorCode).toBe('RATE_LIMITED');
    expect(requests[1]?.requestId).toBe('req_1');
    expect(requests[1]).not.toHaveProperty('errorCode');
  });

  it('caps the ledger at MAX_RECENT_REQUESTS entries', async () => {
    for (let i = 0; i < MAX_RECENT_REQUESTS + 5; i += 1) {
      await recordRecentRequest(entry({ requestId: `req_${i}` }));
    }
    const requests = await listRecentRequests();
    expect(requests).toHaveLength(MAX_RECENT_REQUESTS);
    expect(requests[0]?.requestId).toBe(`req_${MAX_RECENT_REQUESTS + 4}`);
  });

  it('tolerates a corrupt ledger file: reads empty, recording starts fresh', async () => {
    const ledgerPath = join(fintermDir, 'recent-requests.json');
    await writeFile(ledgerPath, '{not json');

    await expect(listRecentRequests()).resolves.toEqual([]);
    await recordRecentRequest(entry({ requestId: 'req_after' }));
    const requests = await listRecentRequests();
    expect(requests).toHaveLength(1);
    expect(JSON.parse(await readFile(ledgerPath, 'utf-8'))).toMatchObject({ version: 1 });
  });

  it('drops malformed entries but keeps well-formed ones', async () => {
    const ledgerPath = join(fintermDir, 'recent-requests.json');
    await writeFile(
      ledgerPath,
      JSON.stringify({ version: 1, requests: [entry(), { junk: true }, 42] })
    );
    await expect(listRecentRequests()).resolves.toHaveLength(1);
  });

  it('recording never throws, even when the ledger path is unwritable', async () => {
    vi.stubEnv('FINTERM_CONFIG', '/nonexistent/finterm-dir');
    await expect(recordRecentRequest(entry())).resolves.toBeUndefined();
  });

  it('writes the ledger owner-readable only (0600)', async () => {
    await recordRecentRequest(entry());
    const { statSync } = await import('node:fs');
    const mode = statSync(join(fintermDir, 'recent-requests.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('keeps every entry under concurrent recording (cross-process lock)', async () => {
    const CONCURRENT_WRITES = 10;
    await Promise.all(
      Array.from({ length: CONCURRENT_WRITES }, (_, i) =>
        recordRecentRequest(entry({ requestId: `req_${i}` }))
      )
    );
    const requests = await listRecentRequests();
    expect(requests).toHaveLength(CONCURRENT_WRITES);
  });
});

describe('buildRecentRequestEntry', () => {
  it('captures tool, request id, and command from a success envelope', () => {
    const built = buildRecentRequestEntry(
      {
        finterm: {
          schema: 'finterm.result:TickerSentiment/v1',
          tool: 'ticker_sentiment',
          args: {},
          request_id: 'req_ok',
        },
        data: { score: 1 },
      },
      ['node', 'bin.js', 'tool', 'ticker_sentiment', 'META']
    );
    expect(built.command).toBe('finterm tool ticker_sentiment META');
    expect(built.tool).toBe('ticker_sentiment');
    expect(built.requestId).toBe('req_ok');
    expect(built).not.toHaveProperty('errorCode');
  });

  it('captures the error code from an error envelope', () => {
    const built = buildRecentRequestEntry(
      {
        finterm: {
          schema: 'finterm.result:TickerSentiment/v1',
          tool: 'ticker_sentiment',
          args: {},
          request_id: 'req_bad',
        },
        error: { code: 'RUNTIME_UNAVAILABLE', message: 'down' },
      },
      ['node', 'bin.js', 'tool', 'ticker_sentiment', 'META']
    );
    expect(built.errorCode).toBe('RUNTIME_UNAVAILABLE');
    expect(built.requestId).toBe('req_bad');
  });

  it('commandLineFromArgv strips the interpreter and script path', () => {
    expect(commandLineFromArgv(['node', '/x/bin.js', 'feedback', 'bug', 'oops'])).toBe(
      'finterm feedback bug oops'
    );
  });

  it('redacts secret-shaped substrings before they reach disk', () => {
    const token = `${'fint_auth_'}abcdefghij1234567890`;
    const command = commandLineFromArgv(['node', '/x/bin.js', 'auth', 'login', token]);
    expect(command).not.toContain(token);
    expect(command).toContain('[redacted]');
  });

  it('builds a transport_error entry for calls with no wire result', () => {
    const built = buildTransportFailureEntry('ticker_sentiment', new Error('socket hang up'), [
      'node',
      '/x/bin.js',
      'tool',
      'ticker_sentiment',
      'META',
    ]);
    expect(built).toMatchObject({
      tool: 'ticker_sentiment',
      outcome: 'transport_error',
      command: 'finterm tool ticker_sentiment META',
    });
    expect(built).not.toHaveProperty('requestId');
  });
});

describe('pickLastRequestForFeedback', () => {
  it('prefers the most recent failed call over a later success', async () => {
    await recordRecentRequest(entry({ requestId: 'req_err', errorCode: 'RUNTIME_UNAVAILABLE' }));
    await recordRecentRequest(entry({ requestId: 'req_ok' }));

    const picked = await pickLastRequestForFeedback();
    expect(picked?.requestId).toBe('req_err');
  });

  it('falls back to the most recent call when nothing failed', async () => {
    await recordRecentRequest(entry({ requestId: 'req_1' }));
    await recordRecentRequest(entry({ requestId: 'req_2' }));
    const picked = await pickLastRequestForFeedback();
    expect(picked?.requestId).toBe('req_2');
  });

  it('returns null on an empty ledger', async () => {
    await expect(pickLastRequestForFeedback()).resolves.toBeNull();
  });
});

describe('mergeLastRequestContext', () => {
  const last: RecentRequestEntry = {
    at: '2026-07-10T00:00:00.000Z',
    command: 'finterm tool sec_filings_search BRK.B',
    tool: 'sec_filings_search',
    outcome: 'error',
    errorCode: 'RUNTIME_UNAVAILABLE',
    requestId: 'req_last',
  };

  it('fills every context field from the picked entry', () => {
    expect(mergeLastRequestContext({}, last)).toMatchObject({
      command: 'finterm tool sec_filings_search BRK.B',
      tool: 'sec_filings_search',
      errorCode: 'RUNTIME_UNAVAILABLE',
      requestId: ['req_last'],
    });
  });

  it('never overrides explicit flags, and dedupes request ids', () => {
    const merged = mergeLastRequestContext(
      {
        command: 'typed by hand',
        tool: 'typed_tool',
        errorCode: 'TYPED',
        requestId: ['req_last'],
      },
      last
    );
    expect(merged.command).toBe('typed by hand');
    expect(merged.tool).toBe('typed_tool');
    expect(merged.errorCode).toBe('TYPED');
    expect(merged.requestId).toEqual(['req_last']);
  });
});
