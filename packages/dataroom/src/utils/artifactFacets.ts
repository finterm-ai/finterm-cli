/**
 * Searchable artifact facet helpers.
 *
 * @packageDocumentation
 */

import { basename } from 'node:path';

import type {
  ArtifactSearchFacets,
  ArtifactSearchFacetKey,
  FacetFilter,
  FacetValue,
} from '../types.js';
import { normalizeContentType } from './contentType.js';

/**
 * Extract broad-to-specific extension suffixes from a file or blob path.
 *
 * The broad suffix comes first so `.md` and `.process.md` can be queried with
 * the same facet machinery. Numeric segments stop hierarchy expansion to avoid
 * treating version numbers as semantic file kinds.
 *
 * Examples:
 * - notes.md -> ["md"]
 * - run.process.md -> ["md", "process.md"]
 * - cache.bundle.pages.yaml -> ["yaml", "pages.yaml", "bundle.pages.yaml"]
 */
export function extractExtensionSuffixes(path: string): string[] {
  const name = basename(path.replace(/\\/g, '/')).toLowerCase();
  if (!name || name.endsWith('.')) {
    return [];
  }

  const visibleName = name.startsWith('.') ? name.slice(1) : name;
  const parts = visibleName.split('.').filter(Boolean);
  if (parts.length < 2) {
    return [];
  }

  const suffixParts = parts.slice(1);
  const suffixes: string[] = [suffixParts[suffixParts.length - 1]!];
  for (let index = suffixParts.length - 2; index >= 0; index--) {
    if (isNumericOnlySegment(suffixParts[index]!)) {
      break;
    }
    suffixes.push(suffixParts.slice(index).join('.'));
  }
  return suffixes;
}

/**
 * Build normalized facets for a readable artifact.
 *
 * This is deliberately path/content driven today, with declared-kind,
 * frontmatter, and custom fields reserved for future indexing layers. Keeping
 * all facets in one shape gives CLI and agent queries a stable substrate.
 */
export function buildArtifactSearchFacets(input: {
  path: string;
  contentType: string;
  declaredKind?: string;
  schemaId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  frontmatterKeys?: string[];
  custom?: Record<string, FacetValue>;
}): ArtifactSearchFacets {
  const extensionSuffixes = extractExtensionSuffixes(input.path);
  const extension = extensionSuffixes[0] ?? null;
  const fileKind = extensionSuffixes[extensionSuffixes.length - 1] ?? null;

  return {
    contentType: normalizeContentType(input.contentType),
    extension,
    extensionSuffixes,
    fileKind,
    fileKindHierarchy: extensionSuffixes,
    ...(input.declaredKind ? { declaredKind: input.declaredKind } : {}),
    ...(input.schemaId ? { schemaId: input.schemaId } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.tags ? { tags: input.tags.map((tag) => normalizeFacetString(tag)) } : {}),
    ...(input.frontmatterKeys
      ? {
          frontmatterKeys: input.frontmatterKeys.map((key) => normalizeFacetString(key)),
        }
      : {}),
    ...(input.custom ? { custom: input.custom } : {}),
  };
}

/**
 * Test whether a facet object matches all requested filters.
 *
 * Filters are exact-match by design so callers can compose predictable lookups
 * before a richer indexing layer exists.
 */
export function matchesFacetFilters(
  facets: ArtifactSearchFacets,
  filters: FacetFilter[] = []
): boolean {
  return filters.every((filter) => matchesFacetFilter(facets, filter));
}

/**
 * Test whether a facet object matches one requested filter.
 *
 * Array facets match if any normalized member equals the requested value, which
 * lets hierarchy facets satisfy both broad and specific file-kind queries.
 */
export function matchesFacetFilter(facets: ArtifactSearchFacets, filter: FacetFilter): boolean {
  const actual = getFacetValue(facets, filter.key);
  if (actual === undefined) {
    return filter.missing === true;
  }
  if (filter.missing === true) {
    return false;
  }

  const expected = normalizeFacetValue(filter.value);
  if (Array.isArray(actual)) {
    return actual.map(normalizeFacetValue).some((value) => value === expected);
  }
  return normalizeFacetValue(actual) === expected;
}

/**
 * Return a top-level or custom facet value.
 *
 * `custom.foo` is the only namespaced key syntax currently supported; other
 * structured query features should be added above this helper instead of
 * overloading arbitrary dotted paths.
 */
export function getFacetValue(
  facets: ArtifactSearchFacets,
  key: ArtifactSearchFacetKey
): FacetValue | FacetValue[] | undefined {
  if (key.startsWith('custom.')) {
    return facets.custom?.[key.slice('custom.'.length)];
  }
  return facets[key as keyof ArtifactSearchFacets] as FacetValue | FacetValue[] | undefined;
}

function normalizeFacetValue(value: FacetValue | FacetValue[]): string {
  if (Array.isArray(value)) {
    return value.map(normalizeFacetValue).join('\u0000');
  }
  if (typeof value === 'string') {
    return normalizeFacetString(value);
  }
  return String(value);
}

function normalizeFacetString(value: string): string {
  return value.trim().toLowerCase();
}

function isNumericOnlySegment(value: string): boolean {
  return /^\d+$/.test(value);
}
