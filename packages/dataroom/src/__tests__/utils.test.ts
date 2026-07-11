import { describe, it, expect } from 'vitest';

// Hash utilities
import { hash12, sha256, actionHash, urlHash12 } from '../utils/hash.js';

// URL normalization
import { normalizeUrl, extractDomain, isValidHttpUrl } from '../utils/urlNormalize.js';

// Blob filename generation
import {
  sanitizeForFilename,
  generateBlobFilename,
  generateUrlBlobFilename,
  generateApiBlobFilename,
  logicalBlobFilename,
  extractExtension,
} from '../utils/blobFilename.js';

// Content type detection
import {
  getContentTypeFromExtension,
  getExtensionFromContentType,
  getContentTypeFromFilename,
  isTextContentType,
  isBinaryContentType,
  normalizeContentType,
} from '../utils/contentType.js';

// YAML utilities
import {
  parseYaml,
  stringifyYaml,
  stringifyDataroomYaml,
  validateRequiredKeys,
  blobCompressionToYaml,
  blobCompressionFromYaml,
  DATAROOM_KEY_ORDER,
} from '../utils/yaml.js';

describe('hash utilities', () => {
  describe('hash12', () => {
    it('should return 12-character hex string', () => {
      const result = hash12('test input');
      expect(result).toHaveLength(12);
      expect(result).toMatch(/^[a-f0-9]{12}$/);
    });

    it('should be deterministic', () => {
      const a = hash12('same input');
      const b = hash12('same input');
      expect(a).toBe(b);
    });

    it('should differ for different inputs', () => {
      const a = hash12('input a');
      const b = hash12('input b');
      expect(a).not.toBe(b);
    });

    it('should accept Buffer input', () => {
      const result = hash12(Buffer.from('test'));
      expect(result).toHaveLength(12);
    });
  });

  describe('sha256', () => {
    it('should return 64-character hex string', () => {
      const result = sha256('test');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should match known hash', () => {
      // SHA-256 of "test" is well-known
      const result = sha256('test');
      expect(result).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    });
  });

  describe('actionHash', () => {
    it('should generate consistent hash for same request', () => {
      const request = {
        provider: 'api',
        endpoint: 'records',
        params: { id: 'a1' },
      };
      const a = actionHash(request);
      const b = actionHash(request);
      expect(a).toBe(b);
    });

    it('should be order-independent for params', () => {
      const a = actionHash({
        provider: 'api',
        endpoint: 'records',
        params: { id: 'a1', year: 2025 },
      });
      const b = actionHash({
        provider: 'api',
        endpoint: 'records',
        params: { year: 2025, id: 'a1' },
      });
      expect(a).toBe(b);
    });

    it('should differ for different params', () => {
      const a = actionHash({
        provider: 'api',
        endpoint: 'records',
        params: { id: 'a1' },
      });
      const b = actionHash({
        provider: 'api',
        endpoint: 'records',
        params: { id: 'b2' },
      });
      expect(a).not.toBe(b);
    });
  });

  describe('urlHash12', () => {
    it('should hash URL to 12 characters', () => {
      const result = urlHash12('https://example.com/page');
      expect(result).toHaveLength(12);
    });
  });
});

describe('URL normalization', () => {
  describe('normalizeUrl', () => {
    it('should lowercase scheme and host', () => {
      expect(normalizeUrl('HTTPS://EXAMPLE.COM/Path')).toBe('https://example.com/Path');
    });

    it('should remove default ports', () => {
      expect(normalizeUrl('https://example.com:443/path')).toBe('https://example.com/path');
      expect(normalizeUrl('http://example.com:80/path')).toBe('http://example.com/path');
    });

    it('should keep non-default ports', () => {
      expect(normalizeUrl('https://example.com:8443/path')).toBe('https://example.com:8443/path');
    });

    it('should remove trailing slashes (except root)', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('should remove fragments by default', () => {
      expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
    });

    it('should keep fragments when requested', () => {
      expect(
        normalizeUrl('https://example.com/page#section', {
          removeFragment: false,
        }),
      ).toBe('https://example.com/page#section');
    });

    it('should sort query parameters', () => {
      expect(normalizeUrl('https://example.com/?z=1&a=2&m=3')).toBe(
        'https://example.com/?a=2&m=3&z=1',
      );
    });

    it('should remove UTM tracking parameters', () => {
      expect(normalizeUrl('https://example.com/?q=test&utm_source=google')).toBe(
        'https://example.com/?q=test',
      );
    });

    it('should remove common tracking parameters', () => {
      const url = 'https://example.com/?q=test&fbclid=abc&gclid=xyz&ref=twitter';
      expect(normalizeUrl(url)).toBe('https://example.com/?q=test');
    });

    it('should reject non-HTTP protocols', () => {
      expect(() => normalizeUrl('ftp://example.com')).toThrow('Unsupported protocol');
      expect(() => normalizeUrl('file:///path/to/file')).toThrow('Unsupported protocol');
    });

    it('should reject invalid URLs', () => {
      expect(() => normalizeUrl('not a url')).toThrow('Invalid URL');
    });
  });

  describe('extractDomain', () => {
    it('should extract and sanitize domain', () => {
      expect(extractDomain('https://docs.example.com/page')).toBe('docs_example_com');
    });

    it('should handle invalid URLs gracefully', () => {
      expect(extractDomain('not a url')).toBe('unknown');
    });
  });

  describe('isValidHttpUrl', () => {
    it('should accept HTTP and HTTPS', () => {
      expect(isValidHttpUrl('https://example.com')).toBe(true);
      expect(isValidHttpUrl('http://example.com')).toBe(true);
    });

    it('should reject non-HTTP protocols', () => {
      expect(isValidHttpUrl('ftp://example.com')).toBe(false);
      expect(isValidHttpUrl('not a url')).toBe(false);
    });
  });
});

describe('blob filename generation', () => {
  describe('sanitizeForFilename', () => {
    it('should lowercase and replace non-alphanumeric', () => {
      expect(sanitizeForFilename('User Name (Admin)')).toBe('user_name_admin');
    });

    it('should collapse multiple underscores', () => {
      expect(sanitizeForFilename('foo---bar___baz')).toBe('foo_bar_baz');
    });

    it('should remove leading/trailing underscores', () => {
      expect(sanitizeForFilename('__foo__')).toBe('foo');
    });

    it('should truncate to max length', () => {
      const result = sanitizeForFilename('a'.repeat(100), 20);
      expect(result).toHaveLength(20);
    });
  });

  describe('generateBlobFilename', () => {
    it('should generate filename with all components', () => {
      const result = generateBlobFilename({
        source: 'api',
        type: 'records',
        identifier: 'item',
        content: 'test content',
        extension: 'json',
      });
      expect(result).toMatch(/^api_records_item_[a-f0-9]{12}\.json$/);
    });

    it('should work without optional components', () => {
      const result = generateBlobFilename({
        source: 'web',
        content: 'test',
        extension: 'html',
      });
      expect(result).toMatch(/^web_[a-f0-9]{12}\.html$/);
    });
  });

  describe('generateUrlBlobFilename', () => {
    it('should generate filename from URL', () => {
      const result = generateUrlBlobFilename('https://example.com/page', 'content', 'html');
      expect(result).toMatch(/^web_example_com_[a-f0-9]{12}\.html$/);
    });
  });

  describe('generateApiBlobFilename', () => {
    it('should generate filename for API response', () => {
      const result = generateApiBlobFilename('api', 'records', 'item', '{"data":1}');
      expect(result).toMatch(/^api_records_item_[a-f0-9]{12}\.json$/);
    });
  });

  describe('extractExtension', () => {
    it('should extract extension from filename', () => {
      expect(extractExtension('file.json')).toBe('json');
      expect(extractExtension('path/to/file.html')).toBe('html');
    });

    it('should handle edge cases', () => {
      expect(extractExtension('noextension')).toBe('');
      expect(extractExtension('file.')).toBe('');
    });
  });

  describe('logicalBlobFilename', () => {
    it('strips the codec suffix when the blob is encoded', () => {
      expect(logicalBlobFilename({ path: 'blobs/foo.html.gz', encoding: 'gzip' })).toBe('foo.html');
      expect(logicalBlobFilename({ path: 'blobs/foo.json.zst', encoding: 'zstd' })).toBe(
        'foo.json',
      );
    });

    it('keeps the full name for a raw blob (no encoding)', () => {
      expect(logicalBlobFilename({ path: 'blobs/foo.html' })).toBe('foo.html');
      // A real .gz archive stored raw must not have its extension stripped.
      expect(logicalBlobFilename({ path: 'blobs/archive.gz' })).toBe('archive.gz');
    });
  });
});

describe('content type detection', () => {
  describe('getContentTypeFromExtension', () => {
    it('should return correct MIME types', () => {
      expect(getContentTypeFromExtension('json')).toBe('application/json');
      expect(getContentTypeFromExtension('html')).toBe('text/html');
      expect(getContentTypeFromExtension('pdf')).toBe('application/pdf');
    });

    it('should handle leading dot', () => {
      expect(getContentTypeFromExtension('.json')).toBe('application/json');
    });

    it('should return default for unknown extensions', () => {
      expect(getContentTypeFromExtension('xyz')).toBe('application/octet-stream');
    });
  });

  describe('getExtensionFromContentType', () => {
    it('should return correct extensions', () => {
      expect(getExtensionFromContentType('application/json')).toBe('json');
      expect(getExtensionFromContentType('text/html')).toBe('html');
    });

    it('should handle charset parameters', () => {
      expect(getExtensionFromContentType('text/html; charset=utf-8')).toBe('html');
    });

    it('should return default for unknown types', () => {
      expect(getExtensionFromContentType('application/x-unknown')).toBe('bin');
    });
  });

  describe('getContentTypeFromFilename', () => {
    it('should detect content type from filename', () => {
      expect(getContentTypeFromFilename('data.json')).toBe('application/json');
      expect(getContentTypeFromFilename('/path/to/page.html')).toBe('text/html');
    });
  });

  describe('isTextContentType', () => {
    it('should identify text types', () => {
      expect(isTextContentType('text/plain')).toBe(true);
      expect(isTextContentType('text/html')).toBe(true);
      expect(isTextContentType('application/json')).toBe(true);
      expect(isTextContentType('application/xml')).toBe(true);
    });

    it('should identify binary types', () => {
      expect(isTextContentType('image/png')).toBe(false);
      expect(isTextContentType('application/pdf')).toBe(false);
    });
  });

  describe('isBinaryContentType', () => {
    it('should be opposite of isTextContentType', () => {
      expect(isBinaryContentType('text/plain')).toBe(false);
      expect(isBinaryContentType('image/png')).toBe(true);
    });
  });

  describe('normalizeContentType', () => {
    it('should strip parameters', () => {
      expect(normalizeContentType('text/html; charset=utf-8')).toBe('text/html');
    });
  });
});

describe('YAML utilities', () => {
  describe('parseYaml', () => {
    it('should parse YAML to object', () => {
      const result = parseYaml<{ name: string }>('name: test');
      expect(result.name).toBe('test');
    });

    it('should handle arrays', () => {
      const result = parseYaml<string[]>('- a\n- b\n- c');
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });

  describe('stringifyYaml', () => {
    it('should stringify object to YAML', () => {
      const result = stringifyYaml({ name: 'test', value: 123 });
      expect(result).toContain('name: test');
      expect(result).toContain('value: 123');
    });

    it('should apply key ordering', () => {
      const result = stringifyYaml(
        { z: 1, a: 2, format: 'test' },
        { keyOrder: ['format', 'a', 'z'] },
      );
      const lines = result.split('\n');
      const formatLine = lines.findIndex((l) => l.startsWith('format:'));
      const aLine = lines.findIndex((l) => l.startsWith('a:'));
      const zLine = lines.findIndex((l) => l.startsWith('z:'));
      expect(formatLine).toBeLessThan(aLine);
      expect(aLine).toBeLessThan(zLine);
    });
  });

  describe('stringifyDataroomYaml', () => {
    it('should use DATAROOM_KEY_ORDER', () => {
      const metadata = {
        description: 'A description',
        type: 'dataroom',
        name: 'test',
        format: 'DR/0.1',
      };
      const result = stringifyDataroomYaml(metadata);
      const lines = result.split('\n');
      const formatLine = lines.findIndex((l) => l.startsWith('format:'));
      const typeLine = lines.findIndex((l) => l.startsWith('type:'));
      const nameLine = lines.findIndex((l) => l.startsWith('name:'));
      const descLine = lines.findIndex((l) => l.startsWith('description:'));

      // format, type, name, title, description is the expected order
      expect(formatLine).toBeLessThan(typeLine);
      expect(typeLine).toBeLessThan(nameLine);
      expect(nameLine).toBeLessThan(descLine);
    });
  });

  describe('validateRequiredKeys', () => {
    it('should return empty array when all keys present', () => {
      const obj = { format: 'DR/0.1', type: 'dataroom', name: 'test' };
      const missing = validateRequiredKeys(obj, ['format', 'type', 'name']);
      expect(missing).toEqual([]);
    });

    it('should return missing keys', () => {
      const obj = { format: 'DR/0.1' };
      const missing = validateRequiredKeys(obj, ['format', 'type', 'name']);
      expect(missing).toEqual(['type', 'name']);
    });

    it('should treat null/undefined as missing', () => {
      const obj = { format: 'DR/0.1', type: null, name: undefined };
      const missing = validateRequiredKeys(obj, ['format', 'type', 'name']);
      expect(missing).toEqual(['type', 'name']);
    });
  });

  describe('DATAROOM_KEY_ORDER', () => {
    it('should have correct key order', () => {
      expect(DATAROOM_KEY_ORDER).toEqual([
        'format',
        'type',
        'name',
        'profile',
        'title',
        'description',
        'capabilities',
        'blob_compression',
      ]);
    });
  });

  describe('blob_compression mapping', () => {
    it('converts a partial config to snake_case for disk', () => {
      expect(
        blobCompressionToYaml({
          codec: 'zstd',
          minSize: 4096,
          skipContentTypes: ['image/*'],
        }),
      ).toEqual({
        codec: 'zstd',
        min_size: 4096,
        skip_content_types: ['image/*'],
      });
    });

    it('only emits defined fields', () => {
      expect(blobCompressionToYaml({ codec: 'gzip' })).toEqual({
        codec: 'gzip',
      });
    });

    it('parses snake_case blocks', () => {
      expect(blobCompressionFromYaml({ codec: 'zstd', min_size: 4096 })).toEqual({
        codec: 'zstd',
        minSize: 4096,
      });
    });

    it('also tolerates camelCase from hand-edited files', () => {
      expect(
        blobCompressionFromYaml({
          codec: 'gzip',
          minSize: 0,
          skipContentTypes: ['video/*'],
        }),
      ).toEqual({ codec: 'gzip', minSize: 0, skipContentTypes: ['video/*'] });
    });

    it('returns undefined for missing/empty/non-object input', () => {
      expect(blobCompressionFromYaml(undefined)).toBeUndefined();
      expect(blobCompressionFromYaml({})).toBeUndefined();
      expect(blobCompressionFromYaml('zstd')).toBeUndefined();
    });

    it('round-trips through a dataroom manifest', () => {
      const record = {
        format: 'DR/0.1',
        type: 'dataroom',
        name: 'r',
        blob_compression: blobCompressionToYaml({
          codec: 'zstd',
          minSize: 4096,
        }),
      };
      const yaml = stringifyDataroomYaml(record);
      const parsed = parseYaml<Record<string, unknown>>(yaml);
      expect(blobCompressionFromYaml(parsed.blob_compression)).toEqual({
        codec: 'zstd',
        minSize: 4096,
      });
    });
  });
});
