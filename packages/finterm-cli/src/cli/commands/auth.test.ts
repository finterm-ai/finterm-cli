import { describe, expect, it } from 'vitest';

import { planStateLines } from './auth.js';

describe('planStateLines (C2/C4 plan-aware messaging)', () => {
  it('gives a free account the upgrade pointer, with no offer terms', () => {
    const lines = planStateLines({
      hasPro: false,
      status: null,
      trialEndsAt: null,
      upgradeUrl: 'https://app.finterm.ai/pricing',
    });
    expect(lines[0]).toBe('Plan: free — API access requires Pro.');
    expect(lines[1]).toBe('Upgrade: https://app.finterm.ai/pricing');
    expect(lines.join('\n')).not.toMatch(/\$\d|\/month|trial|card/i);
  });

  it('falls back to the known upgrade URL when the server sent none', () => {
    const lines = planStateLines({
      hasPro: false,
      status: null,
      trialEndsAt: null,
      upgradeUrl: null,
    });
    expect(lines[1]).toContain('https://app.finterm.ai/pricing');
  });

  it('shows the trial end date (ISO, timezone-stable) while trialing', () => {
    const lines = planStateLines({
      hasPro: true,
      status: 'trialing',
      trialEndsAt: Date.UTC(2026, 6, 10, 12),
      upgradeUrl: null,
    });
    expect(lines).toEqual(['Plan: Pro (trial ends 2026-07-10)']);
  });

  it('shows plain Pro for an active subscription', () => {
    expect(
      planStateLines({ hasPro: true, status: 'active', trialEndsAt: null, upgradeUrl: null })
    ).toEqual(['Plan: Pro']);
  });

  it('reports a failed payment with the restore pointer', () => {
    const lines = planStateLines({
      hasPro: false,
      status: 'past_due',
      trialEndsAt: null,
      upgradeUrl: 'https://app.finterm.ai/pricing',
    });
    expect(lines[0]).toContain('payment failed');
    expect(lines[1]).toContain('https://app.finterm.ai/pricing');
  });
});
