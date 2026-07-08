import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APIRequestError } from '../../lib/api-client.js';
import type { CommandContext } from './context.js';
import { OutputManager } from './output.js';
import {
  apiCallToFintermWireResult,
  isFintermWireErrorResult,
  printFintermWireResult,
  type FintermWireResult,
} from './wire-result.js';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    dryRun: false,
    verbose: false,
    quiet: false,
    json: false,
    color: 'never',
    nonInteractive: true,
    debug: false,
    experimental: false,
    ...overrides,
  };
}

const SUCCESS_RESULT: FintermWireResult<{ ok: boolean }> = {
  finterm: { schema: 'finterm.result:Test/v1', tool: 'test_tool', args: {} },
  data: { ok: true },
};

const PAYWALL_RESULT: FintermWireResult<never> = {
  finterm: { schema: 'finterm.result:Test/v1', tool: 'test_tool', args: {} },
  error: {
    code: 'SUBSCRIPTION_REQUIRED',
    message: 'A Finterm Pro subscription is required to use the API.',
    upgrade_url: 'https://app.finterm.ai/pricing',
  },
};

describe('printFintermWireResult (C0 routing)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('renders a wire ERROR as the human block on stderr in default mode', async () => {
    const ctx = makeCtx();
    await printFintermWireResult(ctx, new OutputManager(ctx), PAYWALL_RESULT, {});

    // Nothing on stdout: the envelope is not printed in human mode.
    expect(logSpy).not.toHaveBeenCalled();
    const stderrText = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(stderrText).toContain('Finterm Pro required');
    expect(stderrText).toContain('Upgrade: https://app.finterm.ai/pricing');
    expect(stderrText).not.toContain('"finterm"');
    expect(process.exitCode).toBe(1);
  });

  it('keeps the exact wire envelope on stdout under --format json', async () => {
    const ctx = makeCtx();
    await printFintermWireResult(ctx, new OutputManager(ctx), PAYWALL_RESULT, {
      format: 'json',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as typeof PAYWALL_RESULT;
    expect(printed).toEqual(PAYWALL_RESULT);
    expect(process.exitCode).toBe(1);
  });

  it('keeps the wire envelope under the global --json flag', async () => {
    const ctx = makeCtx({ json: true });
    await printFintermWireResult(ctx, new OutputManager(ctx), PAYWALL_RESULT, {});

    const printed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as typeof PAYWALL_RESULT;
    expect(printed.error?.upgrade_url).toBe('https://app.finterm.ai/pricing');
    expect(process.exitCode).toBe(1);
  });

  it('prints success results as the wire envelope in every mode', async () => {
    const ctx = makeCtx();
    await printFintermWireResult(ctx, new OutputManager(ctx), SUCCESS_RESULT, {});

    expect(errorSpy).not.toHaveBeenCalled();
    const printed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as typeof SUCCESS_RESULT;
    expect(printed).toEqual(SUCCESS_RESULT);
    expect(process.exitCode).toBeUndefined();
  });
});

describe('apiCallToFintermWireResult (fin-27bn upstream synthesis)', () => {
  const FALLBACK = { schema: 'finterm.result:Test/v1', tool: 'test_tool', args: {} };

  it('synthesizes an UPSTREAM_HTTP_<status> error for an envelope-less HTTP failure', async () => {
    const result = await apiCallToFintermWireResult(() => {
      throw new APIRequestError('HTTP 502', { status: 502 });
    }, FALLBACK);

    expect(isFintermWireErrorResult(result)).toBe(true);
    if (isFintermWireErrorResult(result)) {
      expect(result.error.code).toBe('UPSTREAM_HTTP_502');
      expect(result.error.message).toContain('HTTP 502');
    }
  });

  it('returns the server wire envelope untouched when the failure body carries one', async () => {
    const body = {
      finterm: FALLBACK,
      error: { code: 'SUBSCRIPTION_REQUIRED', message: 'Pro required.' },
    };
    const result = await apiCallToFintermWireResult(() => {
      throw new APIRequestError('HTTP 402', { status: 402, body });
    }, FALLBACK);
    expect(result).toEqual(body);
  });

  it('still throws non-HTTP failures', async () => {
    await expect(
      apiCallToFintermWireResult(() => {
        throw new Error('socket hang up');
      }, FALLBACK)
    ).rejects.toThrow('socket hang up');
  });
});
