#!/usr/bin/env node
/**
 * Public-metadata guard: PR metadata must be as clean as the tree.
 *
 * The source-tree boundary check (check-public-boundary.mjs) scans only
 * checked-out files, so it cannot see git or PR metadata. This companion
 * scans:
 *   1. every commit subject/body in the PR commit range (COMMIT_RANGE); and
 *   2. the PR title/body when the workflow provides PR_TITLE / PR_BODY;
 * for internal work-tracker ids, internal planning-document references,
 * private coordination-repo names, and agent-session URLs — none of which
 * belong in this repository's public history (see CONTRIBUTING.md).
 *
 * On success it prints a single summary line; on failure it prints the
 * offending items and exits non-zero.
 */
import { execFileSync } from 'node:child_process';

// Patterns are built to avoid embedding the private vocabulary they guard
// against as plain literals in this (public) file.
const metadataPatterns = [
  { label: 'internal work-tracker reference', regex: /\bfin-[0-9a-z]{4,}\b/ },
  {
    label: 'internal planning-document reference',
    regex: /\bplan-\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md\b/,
  },
  {
    label: 'private coordination-repo reference',
    regex: new RegExp('\\bfin' + 'term-main\\b'),
  },
  { label: 'agent-session URL', regex: /\bclaude\.ai\/code\/\S+/ },
];

const violations = [];

function scan(sourceLabel, text) {
  for (const { label, regex } of metadataPatterns) {
    const match = regex.exec(text);
    if (match) {
      violations.push(`${sourceLabel}: ${label} "${match[0]}"`);
    }
  }
}

// 1. Commit subjects/bodies in the PR range.
const range = process.env.COMMIT_RANGE ?? '';
let commitCount = 0;
if (range.length > 0) {
  const log = execFileSync('git', ['log', '--format=%H%x00%B%x00', range], { encoding: 'utf8' });
  const parts = log.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const sha = parts[i].trim();
    if (sha.length === 0) {
      continue;
    }
    commitCount += 1;
    scan(`commit ${sha.slice(0, 10)}`, parts[i + 1]);
  }
} else {
  console.log('check-pr-metadata: COMMIT_RANGE not set; skipping commit-message scan.');
}

// 2. PR title/body, when the workflow provides them.
if (process.env.PR_TITLE) {
  scan('PR title', process.env.PR_TITLE);
}
if (process.env.PR_BODY) {
  scan('PR body', process.env.PR_BODY);
}

if (violations.length > 0) {
  console.error('Public metadata check failed:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Public metadata clean (${commitCount} commit message(s)` +
    `${process.env.PR_TITLE ? ' + PR title/body' : ''} scanned).`
);
