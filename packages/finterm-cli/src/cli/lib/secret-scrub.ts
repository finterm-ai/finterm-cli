/**
 * Obvious credential shapes that must never leave the machine in feedback
 * text or be persisted in local diagnostics: Finterm CLI tokens, `sk-`-style
 * provider keys, bearer headers, and AWS access key ids. A light guard, not a
 * scanner — the feedback payload preview remains the real review step.
 */
const SECRET_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'a Finterm API token (fint_auth_...)', pattern: /fint_auth_[A-Za-z0-9]{8,}/g },
  { label: 'an sk-... style API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  {
    label: 'an Authorization: Bearer header value',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
  },
  { label: 'an AWS access key id (AKIA...)', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
];

/**
 * Return the human label of the first secret-shaped match in `text`, or null
 * when it looks clean.
 */
export function findSecretLikeContent(text: string): string | null {
  for (const { label, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return label;
    }
  }
  return null;
}

/**
 * Replace every secret-shaped substring with a fixed marker. Used before any
 * text is persisted to local diagnostics (the recent-requests ledger), so a
 * token typed into a command line never reaches disk.
 */
export function redactSecretLikeContent(text: string): string {
  let redacted = text;
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, '[redacted]');
  }
  return redacted;
}
