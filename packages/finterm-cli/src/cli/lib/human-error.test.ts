import { describe, expect, it } from 'vitest';

import {
  humanWireErrorLines,
  KEY_ROTATION_LINE,
  PRICE_TRIAL_LINE,
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
    expect(text).toContain(PRICE_TRIAL_LINE);
    expect(text).toContain('Upgrade: https://app.finterm.ai/pricing');
    expect(text).toContain(RESUME_LINE);
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
});
