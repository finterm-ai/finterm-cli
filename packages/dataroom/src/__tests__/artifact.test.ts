/**
 * Tests for artifact refs and searchable facets.
 */
import { describe, it, expect } from 'vitest';

import { ValidationError } from '../errors.js';
import {
  buildArtifactSearchFacets,
  extractExtensionSuffixes,
  formatArtifactRef,
  matchesFacetFilter,
  parseArtifactRef,
} from '../index.js';

describe('artifact refs', () => {
  it('should parse file and blob refs', () => {
    expect(parseArtifactRef('file:derived/abc/report.process.md')).toEqual({
      kind: 'file',
      path: 'derived/abc/report.process.md',
      ref: 'file:derived/abc/report.process.md',
    });
    expect(parseArtifactRef('blob:web_example_com_abc.html')).toEqual({
      kind: 'blob',
      path: 'web_example_com_abc.html',
      ref: 'blob:web_example_com_abc.html',
    });
  });

  it('should format refs without storage directory prefixes', () => {
    expect(formatArtifactRef('file', 'files/notes.md')).toBe('file:notes.md');
    expect(formatArtifactRef('blob', 'blobs/web_example_com_abc.html')).toBe(
      'blob:web_example_com_abc.html',
    );
  });

  it('should reject non-room-local or ambiguous refs', () => {
    expect(() => parseArtifactRef('file:/tmp/notes.md')).toThrow(ValidationError);
    expect(() => parseArtifactRef('file:../notes.md')).toThrow(ValidationError);
    expect(() => parseArtifactRef('file:files/notes.md')).toThrow(ValidationError);
    expect(() => parseArtifactRef('blob:nested/blob.html')).toThrow(ValidationError);
  });
});

describe('artifact facets', () => {
  it('should extract broad-to-specific extension suffixes', () => {
    expect(extractExtensionSuffixes('notes.md')).toEqual(['md']);
    expect(extractExtensionSuffixes('run.process.md')).toEqual(['md', 'process.md']);
    expect(extractExtensionSuffixes('cache.bundle.pages.yaml')).toEqual([
      'yaml',
      'pages.yaml',
      'bundle.pages.yaml',
    ]);
    expect(extractExtensionSuffixes('derived/abc/defuddle-0.18.1.md')).toEqual(['md']);
    expect(extractExtensionSuffixes('reports/filing.10k.md')).toEqual(['md', '10k.md']);
  });

  it('should build normalized facets for compound file kinds', () => {
    const facets = buildArtifactSearchFacets({
      path: 'runs/foo.process.md',
      contentType: 'text/markdown; charset=utf-8',
      tags: [' Important '],
    });

    expect(facets).toMatchObject({
      contentType: 'text/markdown',
      extension: 'md',
      extensionSuffixes: ['md', 'process.md'],
      fileKind: 'process.md',
      fileKindHierarchy: ['md', 'process.md'],
      tags: ['important'],
    });
    expect(matchesFacetFilter(facets, { key: 'fileKindHierarchy', value: 'md' })).toBe(true);
    expect(
      matchesFacetFilter(facets, {
        key: 'fileKindHierarchy',
        value: 'process.md',
      }),
    ).toBe(true);
  });
});
