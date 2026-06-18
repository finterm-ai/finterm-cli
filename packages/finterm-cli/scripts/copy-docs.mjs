#!/usr/bin/env node

/**
 * Copy documentation files to dist for bundled CLI.
 * Run as postbuild script.
 */

import { mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'atomically';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const phase = process.argv[2] || 'postbuild';

/**
 * Copy all matching .md files from a directory to a destination.
 */
function copyMarkdownDir(srcDir, destDir, label, shouldCopy = () => true) {
  if (!existsSync(srcDir)) {
    console.log(`  Skipping ${label} (${srcDir} not found)`);
    return 0;
  }

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  const files = readdirSync(srcDir)
    .filter((f) => f.endsWith('.md'))
    .filter((file) => shouldCopy(join(srcDir, file)));
  for (const file of files) {
    const content = readFileSync(join(srcDir, file), 'utf-8');
    writeFileSync(join(destDir, file), content);
  }

  if (files.length > 0) {
    console.log(`  Copied ${files.length} ${label} to ${destDir}/`);
  }
  return files.length;
}

function isPublishedApiDoc(path) {
  const text = readFileSync(path, 'utf-8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    throw new Error(`${path} is missing YAML frontmatter`);
  }
  const frontmatter = parseYaml(match[1] ?? '');
  return frontmatter?.definition?.publication_state === 'published';
}

if (phase === 'postbuild') {
  const srcDocs = join(root, 'src', 'docs');
  const distDocs = join(root, 'dist', 'docs');

  mkdirSync(distDocs, { recursive: true });

  // Copy top-level docs from src/docs to dist/docs
  const docsFiles = ['SKILL.md', 'finterm-docs.md', 'finterm-prime.md', 'skill-brief.md'];
  for (const file of docsFiles) {
    const content = readFileSync(join(srcDocs, file), 'utf-8');
    writeFileSync(join(distDocs, file), content);
    console.log(`  Copied ${file} to dist/docs/`);
  }

  // Copy shortcuts directory
  copyMarkdownDir(join(srcDocs, 'shortcuts'), join(distDocs, 'shortcuts'), 'shortcuts');

  // Copy resources directory
  copyMarkdownDir(join(srcDocs, 'resources'), join(distDocs, 'resources'), 'resources');

  // Copy only first-release published API references committed under src/api.
  copyMarkdownDir(
    join(root, 'src', 'api'),
    join(root, 'dist', 'api'),
    'published API docs',
    isPublishedApiDoc
  );
}
