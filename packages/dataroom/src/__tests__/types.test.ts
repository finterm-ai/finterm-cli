import { describe, it, expect } from 'vitest';
import { asPathSpec, asFormatVersion, type PathSpec, type FormatVersion } from '../types.js';
import { FILE_PROFILE_FORMAT_VERSION } from '../constants.js';

describe('branded types', () => {
  describe('asPathSpec', () => {
    it('should create PathSpec from valid string', () => {
      const path: PathSpec = asPathSpec('./my-research');
      expect(path).toBe('./my-research');
    });

    it('should accept absolute paths', () => {
      const path: PathSpec = asPathSpec('/home/user/research');
      expect(path).toBe('/home/user/research');
    });

    it('should accept tilde paths', () => {
      const path: PathSpec = asPathSpec('~/shared-blobs');
      expect(path).toBe('~/shared-blobs');
    });

    it('should reject paths with null bytes', () => {
      expect(() => asPathSpec('path\0with\0nulls')).toThrow('Path cannot contain null bytes');
    });
  });

  describe('asFormatVersion', () => {
    it('should create FormatVersion from valid string', () => {
      const version: FormatVersion = asFormatVersion('DR/0.1');
      expect(version).toBe('DR/0.1');
    });

    it('should accept multi-digit versions', () => {
      const version: FormatVersion = asFormatVersion('DR/10.25');
      expect(version).toBe('DR/10.25');
    });

    it('should reject invalid format versions', () => {
      expect(() => asFormatVersion('0.1')).toThrow('Invalid format version');
      expect(() => asFormatVersion('DR-0.1')).toThrow('Invalid format version');
      expect(() => asFormatVersion('DR/0')).toThrow('Invalid format version');
      expect(() => asFormatVersion('DR/a.b')).toThrow('Invalid format version');
    });

    it('should work with the file-profile format constant', () => {
      const version: FormatVersion = asFormatVersion(FILE_PROFILE_FORMAT_VERSION);
      expect(version).toBe(FILE_PROFILE_FORMAT_VERSION);
    });
  });
});

// Interface-literal tests (metadata interfaces, entry interfaces, compression types)
// deleted: 14 tests that constructed typed literals and read fields back, proving nothing
// the TypeScript compiler does not already guarantee. Coverage of the runtime branding
// functions (asPathSpec, asFormatVersion) is retained above.
