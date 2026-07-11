import { describe, expect, it } from 'vitest';

import {
  humanWireErrorLines,
  KEY_ROTATION_LINE,
  REPORT_FEEDBACK_LINE,
  RESUME_LINE,
  UPGRADE_URL_FALLBACK,
} from './human-error.js';

describe('humanWireErrorLines', () => {
  it('renders the 402 paywall block with the machine-readable upgrade URL (C1)', () => {
    const lines = humanWireErrorLines({
      code: 'SUBSCRIPTION_REQUIRED',
      message:
        'A Finterm Pro subscription is required to use the API. Upgrade at https://app.finterm.ai/pricing.',
      upgrade_url: 'https://app.finterm.ai/pricing',
    });

    const text = lines.join('\n');
    expect(lines[0]).toContain('Finterm Pro required');
    expect(text).toContain('A Finterm Pro subscription is required');
    expect(text).toContain('(code: SUBSCRIPTION_REQUIRED)');
    expect(text).toContain('Upgrade: https://app.finterm.ai/pricing');
    expect(text).toContain(RESUME_LINE);
  });

  it('renders a synthesized upstream 5xx as a service fault, not user error', () => {
    const text = humanWireErrorLines({
      code: 'UPSTREAM_HTTP_502',
      message: 'The Finterm API returned HTTP 502 without a structured error.',
    }).join('\n');
    expect(text).toContain('Finterm API request failed (HTTP 502)');
    expect(text).toContain('service-side fault, not a problem with your input');
    expect(text).toContain('contact@finterm.ai');
  });

  it('renders a synthesized upstream 4xx as a rejected request', () => {
    const text = humanWireErrorLines({
      code: 'UPSTREAM_HTTP_404',
      message: 'The Finterm API returned HTTP 404 without a structured error.',
    }).join('\n');
    expect(text).toContain('Finterm API request failed (HTTP 404)');
    expect(text).toContain('Double-check your inputs');
  });

  it('adds no offer terms of its own — price/trial wording is server-owned', () => {
    const text = humanWireErrorLines({
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'A Finterm Pro subscription is required to use the API.',
      upgrade_url: 'https://app.finterm.ai/pricing',
    }).join('\n');
    expect(text).not.toMatch(/\$\d|\/month|trial|card/i);
  });

  it('falls back to the known upgrade URL when the envelope predates the field', () => {
    const lines = humanWireErrorLines({
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'A Finterm Pro subscription is required to use the API.',
    });
    expect(lines.join('\n')).toContain(`Upgrade: ${UPGRADE_URL_FALLBACK}`);
  });

  it('explains key rotation for an invalid/revoked token (C3)', () => {
    for (const code of ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REVOKED']) {
      const text = humanWireErrorLines({ code, message: 'Token not found' }).join('\n');
      expect(text).toContain('Not authenticated');
      expect(text).toContain(KEY_ROTATION_LINE);
      expect(text).toContain('finterm auth login');
      expect(text).toContain(`(code: ${code})`);
    }
  });

  it('points a missing token at login or FINTERM_API_KEY', () => {
    const text = humanWireErrorLines({
      code: 'TOKEN_MISSING',
      message: 'Authorization header with Bearer token required',
    }).join('\n');
    expect(text).toContain('finterm auth login');
    expect(text).toContain('FINTERM_API_KEY');
  });

  it('renders runtime failures with a retry pointer', () => {
    const text = humanWireErrorLines({
      code: 'RUNTIME_UNAVAILABLE',
      message: 'The data runtime rejected this request',
    }).join('\n');
    expect(text).toContain('Data runtime unavailable');
    expect(text).toContain('Try again shortly');
  });

  it('keeps unknown codes concise: title, message, code', () => {
    const lines = humanWireErrorLines({ code: 'SOMETHING_NEW', message: 'It broke.' });
    expect(lines[0]).toContain('Request failed');
    expect(lines[1]).toContain('It broke.');
    expect(lines[2]).toContain('(code: SOMETHING_NEW)');
    expect(lines).toHaveLength(3);
  });

  it('prints the server request id when the envelope carried one', () => {
    const lines = humanWireErrorLines(
      { code: 'RUNTIME_UNAVAILABLE', message: 'down' },
      'req_abc123'
    );
    expect(lines.join('\n')).toContain('(request id: req_abc123)');
    const without = humanWireErrorLines({ code: 'RUNTIME_UNAVAILABLE', message: 'down' });
    expect(without.join('\n')).not.toContain('request id');
  });

  it('offers the in-product report on service faults (user feedback loop)', () => {
    // Synthesized upstream 5xx and every RUNTIME_*/tool-fault class carry the
    // `finterm feedback bug` affordance; caller-input errors do not.
    const faultCodes = [
      'UPSTREAM_HTTP_502',
      'RUNTIME_UNAVAILABLE',
      'RUNTIME_QUEUE_FULL',
      'RUNTIME_RUN_FAILED',
      'RUNTIME_CONTRACT_MISMATCH',
      'TOOL_EXECUTION_FAILED',
    ];
    for (const code of faultCodes) {
      const text = humanWireErrorLines({ code, message: 'It broke.' }).join('\n');
      expect(text, code).toContain(REPORT_FEEDBACK_LINE);
      expect(text, code).toContain('finterm feedback bug');
      expect(text, code).toContain('--last');
    }
    for (const code of ['UPSTREAM_HTTP_404', 'VALIDATION_ERROR', 'TOKEN_MISSING']) {
      const text = humanWireErrorLines({ code, message: 'Bad input.' }).join('\n');
      expect(text, code).not.toContain('finterm feedback');
    }
  });
});
