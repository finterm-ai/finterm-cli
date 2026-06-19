import { describe, it, expect } from 'vitest';
import {
  asPathSpec,
  asFormatVersion,
  type PathSpec,
  type FormatVersion,
  type DataRoomMetadata,
  type DataLibMetadata,
  type FileEntry,
  type BlobEntry,
  type BlobSource,
  type BlobEncoding,
  type CodecChoice,
  type BlobCompressionConfig,
  type FetchOptions,
  type FetchApiOptions,
} from '../types.js';
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

describe('metadata interfaces', () => {
  it('should allow valid DataRoomMetadata', () => {
    const metadata: DataRoomMetadata = {
      format: asFormatVersion('DR/0.1'),
      type: 'dataroom',
      name: 'my-research',
      title: 'My Research Project',
      description: 'A research project about something',
    };

    expect(metadata.format).toBe('DR/0.1');
    expect(metadata.type).toBe('dataroom');
    expect(metadata.name).toBe('my-research');
  });

  it('should allow minimal DataRoomMetadata', () => {
    const metadata: DataRoomMetadata = {
      format: asFormatVersion('DR/0.1'),
      type: 'dataroom',
      name: 'minimal-room',
    };

    expect(metadata.title).toBeUndefined();
    expect(metadata.description).toBeUndefined();
  });

  it('should allow valid DataLibMetadata', () => {
    const metadata: DataLibMetadata = {
      format: asFormatVersion('DR/0.1'),
      type: 'datalib',
      name: 'tech-research',
      blob_layers: [{ path: asPathSpec('./cache/') }, { path: asPathSpec('~/shared-blobs/') }],
      rooms: [
        { id: 'topic-alpha', path: asPathSpec('./rooms/topic-alpha/') },
        { id: 'topic-beta', path: asPathSpec('./rooms/topic-beta/') },
      ],
    };

    expect(metadata.blob_layers).toHaveLength(2);
    expect(metadata.rooms).toHaveLength(2);
  });
});

describe('entry interfaces', () => {
  it('should allow valid FileEntry', () => {
    const entry: FileEntry = {
      path: 'files/report.md',
      digest: 'abc123',
      size: 1024,
      contentType: 'text/markdown',
      addedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    };

    expect(entry.path).toBe('files/report.md');
  });

  it('should allow valid BlobEntry', () => {
    const source: BlobSource = {
      type: 'url',
      url: 'https://example.com/page.html',
    };

    const entry: BlobEntry = {
      path: 'blobs/web_example_com_abc123.html',
      digest: 'def456',
      size: 2048,
      contentType: 'text/html',
      fetchedAt: '2026-01-01T00:00:00Z',
      source,
      http: {
        status: 200,
        headers: { 'content-type': 'text/html' },
        finalUrl: 'https://example.com/page.html',
      },
    };

    expect(entry.source.type).toBe('url');
    expect(entry.http?.status).toBe(200);
  });

  it('should allow BlobEntry with API source', () => {
    const source: BlobSource = {
      type: 'api',
      provider: 'api',
      endpoint: 'records',
      params: { id: 'a1', year: 2025 },
    };

    const entry: BlobEntry = {
      path: 'blobs/api_records_item_abc123.json',
      digest: 'ghi789',
      size: 4096,
      contentType: 'application/json',
      fetchedAt: '2026-01-01T00:00:00Z',
      source,
    };

    expect(entry.source.provider).toBe('api');
    expect(entry.source.params?.id).toBe('a1');
  });

  it('should allow BlobEntry with TTL', () => {
    const entry: BlobEntry = {
      path: 'blobs/cached_data.json',
      digest: 'jkl012',
      size: 512,
      contentType: 'application/json',
      fetchedAt: '2026-01-01T00:00:00Z',
      source: { type: 'api', provider: 'test' },
      expiresAt: '2026-01-02T00:00:00Z',
    };

    expect(entry.expiresAt).toBe('2026-01-02T00:00:00Z');
  });

  it('should allow BlobEntry with compression fields', () => {
    const entry: BlobEntry = {
      path: 'blobs/web_example_com_abc123.html.zst',
      digest: 'uncompressed-sha',
      size: 2_662_148,
      contentType: 'text/html',
      fetchedAt: '2026-01-01T00:00:00Z',
      source: { type: 'url', url: 'https://example.com' },
      encoding: 'zstd',
      storedSize: 119_089,
      storedDigest: 'compressed-sha',
    };

    expect(entry.encoding).toBe('zstd');
    expect(entry.storedSize).toBeLessThan(entry.size);
  });
});

describe('compression types', () => {
  it('should accept gzip, zstd, and brotli as BlobEncoding', () => {
    const encodings: BlobEncoding[] = ['gzip', 'zstd', 'brotli'];
    expect(encodings).toHaveLength(3);
  });

  it('should accept BlobEncoding plus none as CodecChoice', () => {
    const choices: CodecChoice[] = ['gzip', 'zstd', 'brotli', 'none'];
    expect(choices).toContain('none');
  });

  it('should allow a full BlobCompressionConfig', () => {
    const config: BlobCompressionConfig = {
      codec: 'zstd',
      minSize: 4096,
      skipContentTypes: ['image/*'],
    };
    expect(config.codec).toBe('zstd');
  });

  it('should allow FetchOptions.encoding to be a codec or none', () => {
    const raw: FetchOptions = { encoding: 'none' };
    const gz: FetchOptions = { encoding: 'gzip' };
    expect(raw.encoding).toBe('none');
    expect(gz.encoding).toBe('gzip');
  });

  it('should allow FetchApiOptions.encoding to be a codec or none', () => {
    const opts: FetchApiOptions<unknown> = {
      provider: 'p',
      endpoint: 'e',
      params: {},
      fetcher: async () => ({}),
      encoding: 'none',
    };
    expect(opts.encoding).toBe('none');
  });

  it('should give the metadata interfaces an optional blobCompression block', () => {
    const room: DataRoomMetadata = {
      format: asFormatVersion('DR/0.1'),
      type: 'dataroom',
      name: 'r',
      blobCompression: { codec: 'gzip' },
    };
    const lib: DataLibMetadata = {
      format: asFormatVersion('DR/0.1'),
      type: 'datalib',
      name: 'l',
      blob_layers: [],
      rooms: [],
      blobCompression: { minSize: 0 },
    };
    expect(room.blobCompression?.codec).toBe('gzip');
    expect(lib.blobCompression?.minSize).toBe(0);
  });
});
