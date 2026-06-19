import { describe, it, expect } from 'vitest';
import { urlKey, callKey, parseKey } from '../utils/cacheKey.js';
import { canonicalizeForHash, actionHash } from '../utils/hash.js';

// Canonicalization test vectors.
// These lock the canonical-form contract shared by callKey and actionHash.
describe('canonicalizeForHash vectors', () => {
  const vectors: Array<[string, unknown, string]> = [
    ['sorts object keys', { b: 2, a: 1 }, '{"a":1,"b":2}'],
    ['drops undefined, keeps null', { x: undefined, y: null, a: 1 }, '{"a":1,"y":null}'],
    [
      'recurses nested objects and preserves array order',
      { arr: [3, 1, { z: 1, a: 2 }], m: { d: 4, c: 3 } },
      '{"arr":[3,1,{"a":2,"z":1}],"m":{"c":3,"d":4}}',
    ],
    ['top-level null/undefined become null', undefined, 'null'],
  ];
  for (const [name, input, expected] of vectors) {
    it(name, () => {
      expect(JSON.stringify(canonicalizeForHash(input))).toBe(expected);
    });
  }

  it('callKey is order-independent and deterministic', () => {
    expect(callKey('rec', { a: 1, b: 2 })).toBe(callKey('rec', { b: 2, a: 1 }));
  });

  it('actionHash is order-independent and deterministic', () => {
    const a = actionHash({
      provider: 'p',
      endpoint: 'e',
      params: { a: 1, b: 2 },
    });
    const b = actionHash({
      provider: 'p',
      endpoint: 'e',
      params: { b: 2, a: 1 },
    });
    expect(a).toBe(b);
  });

  it('documents that callKey and actionHash are SEPARATE namespaces', () => {
    // The same logical call produces unrelated keys: callKey hashes {name,args},
    // actionHash hashes {provider,endpoint,params}. Data cached via one is not
    // retrievable via the other; this is intended, not a bug.
    const call = callKey('prices', { ticker: 'AAPL' });
    const action = actionHash({
      provider: 'prices',
      endpoint: 'prices',
      params: { ticker: 'AAPL' },
    });
    expect(call.startsWith('call:')).toBe(true);
    expect(call).not.toContain(action);
  });
});

describe('cacheKey', () => {
  describe('urlKey', () => {
    it('should build a url: key from a normalized URL', () => {
      expect(urlKey('https://example.com/page')).toBe('url:https://example.com/page');
    });

    it('should normalize the URL so equivalent URLs share a key', () => {
      expect(urlKey('HTTPS://EXAMPLE.COM/Path')).toBe(urlKey('https://example.com/Path'));
      expect(urlKey('https://example.com:443/x')).toBe(urlKey('https://example.com/x'));
    });
  });

  describe('callKey', () => {
    it('should build a call: key from a name and args', () => {
      const key = callKey('prices', { ticker: 'a1' });
      expect(key.startsWith('call:prices:')).toBe(true);
    });

    it('should be order-independent for args (canonicalized)', () => {
      expect(callKey('rec', { a: 1, b: 2 })).toBe(callKey('rec', { b: 2, a: 1 }));
    });

    it('should differ for different args', () => {
      expect(callKey('rec', { id: 'a1' })).not.toBe(callKey('rec', { id: 'b2' }));
    });

    it('should differ for different names', () => {
      expect(callKey('x', { id: 1 })).not.toBe(callKey('y', { id: 1 }));
    });
  });

  describe('parseKey', () => {
    it('should parse a url: key', () => {
      expect(parseKey('url:https://example.com/page')).toEqual({
        scheme: 'url',
        rest: 'https://example.com/page',
      });
    });

    it('should parse a call: key', () => {
      expect(parseKey('call:prices:abc123')).toEqual({
        scheme: 'call',
        rest: 'prices:abc123',
      });
    });

    it('should parse a file: key', () => {
      expect(parseKey('file:notes.md')).toEqual({
        scheme: 'file',
        rest: 'notes.md',
      });
    });

    it('should return undefined for an unknown scheme', () => {
      expect(parseKey('weird:thing')).toBeUndefined();
    });
  });
});
