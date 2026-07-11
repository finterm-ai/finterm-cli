#!/usr/bin/env tsx
/**
 * Behavioral smoke test for the built public finterm binary.
 *
 * The test runs command discovery and one point-tool call against a local HTTP server
 * so it exercises the binary, auth token lookup, request body, API client, and result
 * rendering without depending on live Finterm services.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Process exit code used by subprocesses when they complete successfully. */
const EXIT_SUCCESS = 0;

/** Process exit code used when the smoke test itself fails. */
const EXIT_FAILURE = 1;

/** Ask the OS for an available local test port. */
const RANDOM_PORT = 0;

/** HTTP status for a successful mocked API response. */
const HTTP_OK = 200;

/** HTTP status for a route the smoke server does not implement. */
const HTTP_NOT_FOUND = 404;

/** HTTP status for missing or incorrect bearer-token auth. */
const HTTP_UNAUTHORIZED = 401;

/** HTTP status for an unexpected smoke-server failure. */
const HTTP_INTERNAL_SERVER_ERROR = 500;

/** Maximum time allowed for one finterm subprocess in the smoke. */
const COMMAND_TIMEOUT_MS = 10000;

/** Token supplied through FINTERM_API_KEY for the e2e subprocess. */
const SMOKE_TOKEN = 'fint_auth_e2e_smoke';

/** Expected Authorization header produced by the CLI. */
const SMOKE_AUTH_HEADER = `Bearer ${SMOKE_TOKEN}`;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builtBin = join(packageRoot, 'dist', 'bin-bootstrap.cjs');

interface RunOptions {
  env?: NodeJS.ProcessEnv;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

function runFinterm(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [builtBin, ...args], {
      cwd: packageRoot,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, COMMAND_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut || code !== EXIT_SUCCESS) {
        const details = [
          `Command failed: finterm ${args.join(' ')}`,
          timedOut ? `Timed out after ${COMMAND_TIMEOUT_MS}ms` : undefined,
          signal ? `Signal: ${signal}` : undefined,
          stdout.trim(),
          stderr.trim(),
        ]
          .filter(Boolean)
          .join('\n\n');
        rejectRun(new Error(details));
        return;
      }

      resolveRun({ stdout, stderr });
    });
  });
}

function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve(text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {});
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { connection: 'close', 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: RecordedRequest[]
): Promise<void> {
  const knownRoutes = ['/api/v1/fundamentals/financials', '/api/v1/feedback'];
  if (request.method !== 'POST' || !knownRoutes.includes(request.url ?? '')) {
    sendJson(response, HTTP_NOT_FOUND, {
      error: { code: 'NOT_FOUND', message: `Unexpected route: ${request.method} ${request.url}` },
    });
    return;
  }

  if (request.headers.authorization !== SMOKE_AUTH_HEADER) {
    sendJson(response, HTTP_UNAUTHORIZED, {
      error: { code: 'UNAUTHORIZED', message: 'Missing smoke auth header.' },
    });
    return;
  }

  const body = await readRequestJson(request);

  if (request.url === '/api/v1/feedback') {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body,
    });
    sendJson(response, HTTP_OK, {
      finterm: {
        schema: 'finterm.result:FeedbackAck/v1',
        tool: 'feedback',
        args: {},
        request_id: 'smoke_feedback_request',
      },
      data: { feedback_id: 'fb_smoke_1', status: 'received' },
    });
    return;
  }
  requests.push({
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization,
    body,
  });

  sendJson(response, HTTP_OK, {
    finterm: {
      schema: 'finterm.result:FinancialStatements/v1',
      tool: 'financial_statements',
      args: {
        ticker: body.ticker,
        statement_type: body.statement_type,
        as_of_date: body.as_of_date,
        timeframe: body.timeframe,
        limit: body.limit,
      },
      request_id: 'smoke_request',
    },
    data: {
      ticker: body.ticker,
      statement_type: body.statement_type,
      periods: [
        {
          fiscal_year: 2024,
          fiscal_quarter: 1,
          timeframe: body.timeframe,
          period_end: '2024-03-30',
          total_revenue: 383285000000,
        },
      ],
    },
  });
}

async function startSmokeServer(): Promise<{
  baseUrl: string;
  requests: RecordedRequest[];
  server: Server;
}> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    void handleRequest(request, response, requests).catch((error: unknown) => {
      sendJson(response, HTTP_INTERNAL_SERVER_ERROR, {
        error: { code: 'SMOKE_SERVER_ERROR', message: String(error) },
      });
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(RANDOM_PORT, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    server,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });
}

function assertIncludes(haystack: string, needle: string, context: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Expected ${context} to include ${JSON.stringify(needle)}`);
  }
}

async function main(): Promise<void> {
  if (!existsSync(builtBin)) {
    throw new Error(`Expected built binary at ${builtBin}. Run pnpm build before test:e2e.`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'finterm-e2e-smoke-'));
  const fintermConfig = join(tempRoot, '.finterm');
  const smokeServer = await startSmokeServer();

  try {
    const baseEnv: NodeJS.ProcessEnv = {
      FINTERM_API_KEY: SMOKE_TOKEN,
      FINTERM_API_URL: smokeServer.baseUrl,
      FINTERM_CONFIG: fintermConfig,
      HOME: tempRoot,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    };

    const topHelp = (await runFinterm(['--help'], { env: baseEnv })).stdout;
    assertIncludes(topHelp, 'tool', 'finterm --help');

    const toolHelp = (await runFinterm(['tool', '--help'], { env: baseEnv })).stdout;
    assertIncludes(toolHelp, 'financial_statements', 'finterm tool --help');
    assertIncludes(toolHelp, 'ticker_sentiment', 'finterm tool --help');

    const tickerHelp = (await runFinterm(['tool', 'ticker_sentiment', '--help'], { env: baseEnv }))
      .stdout;
    assertIncludes(tickerHelp, '0-100 sentiment composite', 'finterm tool ticker_sentiment --help');

    const toolCall = await runFinterm(
      [
        'tool',
        'financial_statements',
        'AAPL',
        '--statement-type',
        'income_statement',
        '--as-of-date',
        '2024-05-03',
        '--timeframe',
        'quarterly',
        '--limit',
        '1',
        '--format',
        'json',
      ],
      { env: baseEnv }
    );

    const parsed = JSON.parse(toolCall.stdout) as {
      finterm?: { tool?: string };
      data?: { ticker?: string; periods?: unknown[] };
    };
    if (parsed.finterm?.tool !== 'financial_statements') {
      throw new Error(`Expected financial_statements result, got ${toolCall.stdout}`);
    }
    if (parsed.data?.ticker !== 'AAPL' || parsed.data.periods?.length !== 1) {
      throw new Error(`Unexpected financial_statements payload: ${toolCall.stdout}`);
    }

    const request = smokeServer.requests[0];
    expectRequest(request);

    // Feedback disclosure is unsuppressible: a --quiet submission must still
    // print the exact payload (stderr) before sending, in text and JSON modes.
    const quietText = await runFinterm(
      ['--quiet', 'feedback', 'bug', 'smoke summary', '--body', 'smoke body'],
      { env: baseEnv }
    );
    assertIncludes(quietText.stderr, 'Sending feedback payload:', 'quiet feedback stderr');
    assertIncludes(quietText.stderr, '"smoke summary"', 'quiet feedback stderr payload');
    assertIncludes(quietText.stderr, '"submission_id"', 'quiet feedback stderr payload');

    const quietJson = await runFinterm(
      ['--quiet', '--json', 'feedback', 'question', 'smoke json summary'],
      { env: baseEnv }
    );
    assertIncludes(quietJson.stderr, '"feedbackPayload"', 'quiet json feedback stderr');
    assertIncludes(quietJson.stderr, 'smoke json summary', 'quiet json feedback stderr payload');
    const ack = JSON.parse(quietJson.stdout) as { data?: { feedback_id?: string } };
    if (ack.data?.feedback_id !== 'fb_smoke_1') {
      throw new Error(`Unexpected feedback ack: ${quietJson.stdout}`);
    }

    const feedbackRequests = smokeServer.requests.filter((r) => r.url === '/api/v1/feedback');
    if (feedbackRequests.length !== 2) {
      throw new Error(`Expected 2 feedback submissions, saw ${feedbackRequests.length}`);
    }
    for (const submission of feedbackRequests) {
      if (typeof submission.body.submission_id !== 'string') {
        throw new Error('Feedback submission missing its idempotency submission_id.');
      }
    }

    console.log(
      'E2E smoke passed: help, point-tool call, and quiet-mode feedback disclosure succeeded'
    );
  } finally {
    await closeServer(smokeServer.server);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function expectRequest(request: RecordedRequest | undefined): void {
  if (!request) {
    throw new Error('Expected one request to the local smoke server.');
  }
  if (request.authorization !== SMOKE_AUTH_HEADER) {
    throw new Error(`Unexpected Authorization header: ${request.authorization ?? '<missing>'}`);
  }
  expectRequestField(request.body, 'ticker', 'AAPL');
  expectRequestField(request.body, 'statement_type', 'income_statement');
  expectRequestField(request.body, 'as_of_date', '2024-05-03');
  expectRequestField(request.body, 'timeframe', 'quarterly');
  expectRequestField(request.body, 'limit', 1);
}

function expectRequestField(
  body: Record<string, unknown>,
  field: string,
  expected: string | number
): void {
  if (body[field] !== expected) {
    const actual = JSON.stringify(body[field]);
    throw new Error(`Expected request.${field} to be ${JSON.stringify(expected)}, got ${actual}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`E2E smoke failed: ${message}`);
  process.exit(EXIT_FAILURE);
});
