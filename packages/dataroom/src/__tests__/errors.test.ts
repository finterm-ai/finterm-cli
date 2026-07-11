import { describe, it, expect } from 'vitest';
import {
  ConfigurationError,
  DataRoomError,
  DecodeError,
  NotFoundError,
  ReadOnlyError,
  OfflineError,
  CacheMissError,
  EntryNotFoundError,
  FormatError,
  ValidationError,
  FetchError,
  IndexError,
  SealedRoomError,
} from '../errors.js';

describe('error classes', () => {
  describe('DataRoomError', () => {
    it('should be instance of Error', () => {
      const error = new DataRoomError('test error');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DataRoomError);
    });
  });

  describe('error inheritance', () => {
    it('all errors should extend DataRoomError', () => {
      expect(new NotFoundError('/path')).toBeInstanceOf(DataRoomError);
      expect(new ReadOnlyError('op')).toBeInstanceOf(DataRoomError);
      expect(new OfflineError('url')).toBeInstanceOf(DataRoomError);
      expect(new SealedRoomError('key')).toBeInstanceOf(DataRoomError);
      expect(new CacheMissError('url', 'norm')).toBeInstanceOf(DataRoomError);
      expect(new EntryNotFoundError('key')).toBeInstanceOf(DataRoomError);
      expect(new FormatError('a', 'b')).toBeInstanceOf(DataRoomError);
      expect(new ValidationError('msg')).toBeInstanceOf(DataRoomError);
      expect(new FetchError('url')).toBeInstanceOf(DataRoomError);
      expect(new IndexError('msg', 'path')).toBeInstanceOf(DataRoomError);
    });
  });

  // Observable runtime contracts: message formatting, field assignment,
  // defaults, and cause chaining are not type-system guarantees, and CLI
  // error rendering depends on them.
  describe('constructor contracts', () => {
    const cause = new Error('socket closed');

    const cases: {
      make: () => DataRoomError;
      name: string;
      message: string;
      fields?: Record<string, unknown>;
      cause?: Error;
    }[] = [
      {
        make: () => new NotFoundError('/path/to/room'),
        name: 'NotFoundError',
        message: 'room not found at: /path/to/room',
        fields: { path: '/path/to/room', resourceType: 'room' },
      },
      {
        make: () => new NotFoundError('/path/to/file.txt', 'file'),
        name: 'NotFoundError',
        message: 'file not found at: /path/to/file.txt',
        fields: { resourceType: 'file' },
      },
      {
        make: () => new ReadOnlyError('add file'),
        name: 'ReadOnlyError',
        message: 'Cannot add file: room is opened in readonly mode',
        fields: { operation: 'add file' },
      },
      {
        make: () => new OfflineError('https://example.com/a'),
        name: 'OfflineError',
        message: 'Cannot fetch https://example.com/a: room is opened in offline mode',
        fields: { url: 'https://example.com/a' },
      },
      {
        make: () => new SealedRoomError('url:https://example.com/a'),
        name: 'SealedRoomError',
        message:
          '"url:https://example.com/a" is not cached and the dataroom is sealed ' +
          '(no external operations permitted)',
        fields: { key: 'url:https://example.com/a' },
      },
      {
        make: () => new CacheMissError('https://example.com/A', 'https://example.com/a'),
        name: 'CacheMissError',
        message: 'URL not in cache: https://example.com/A',
        fields: { url: 'https://example.com/A', normalizedUrl: 'https://example.com/a' },
      },
      {
        make: () => new EntryNotFoundError('blob:missing.html'),
        name: 'EntryNotFoundError',
        message: 'Entry not found: blob:missing.html',
        fields: { key: 'blob:missing.html' },
      },
      {
        make: () => new FormatError('DR/0.3', 'DR/0.1'),
        name: 'FormatError',
        message: 'Incompatible format version: expected DR/0.3, got DR/0.1',
        fields: { expected: 'DR/0.3', actual: 'DR/0.1' },
      },
      {
        make: () => new ValidationError('bad manifest'),
        name: 'ValidationError',
        message: 'bad manifest',
        fields: { issues: [] },
      },
      {
        make: () => new ValidationError('bad manifest', ['missing format', 'missing name']),
        name: 'ValidationError',
        message: 'bad manifest: missing format, missing name',
        fields: { issues: ['missing format', 'missing name'] },
      },
      {
        make: () => new FetchError('https://example.com/a'),
        name: 'FetchError',
        message: 'Failed to fetch https://example.com/a',
        fields: { url: 'https://example.com/a', statusCode: undefined },
      },
      {
        make: () => new FetchError('https://example.com/a', 503, cause),
        name: 'FetchError',
        message: 'Failed to fetch https://example.com/a (status: 503): socket closed',
        fields: { statusCode: 503 },
        cause,
      },
      {
        make: () => new ConfigurationError('codec unavailable in this runtime'),
        name: 'ConfigurationError',
        message: 'codec unavailable in this runtime',
      },
      {
        make: () => new DecodeError('corrupt stored frame', cause),
        name: 'DecodeError',
        message: 'corrupt stored frame: socket closed',
        cause,
      },
      {
        make: () => new IndexError('open failed', 'data/blobs.index', cause),
        name: 'IndexError',
        message: 'Index error in data/blobs.index: open failed: socket closed',
        fields: { indexPath: 'data/blobs.index' },
        cause,
      },
    ];

    it.each(cases)('$name: "$message"', ({ make, name, message, fields, cause: wanted }) => {
      const error = make();
      expect(error.name).toBe(name);
      expect(error.message).toBe(message);
      for (const [key, value] of Object.entries(fields ?? {})) {
        expect((error as unknown as Record<string, unknown>)[key]).toEqual(value);
      }
      if (wanted) {
        expect(error.cause).toBe(wanted);
      }
    });
  });
});
