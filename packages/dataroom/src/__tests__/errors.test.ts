import { describe, it, expect } from 'vitest';
import {
  DataRoomError,
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

    it('should have correct name and message', () => {
      const error = new DataRoomError('something went wrong');
      expect(error.name).toBe('DataRoomError');
      expect(error.message).toBe('something went wrong');
    });
  });

  describe('NotFoundError', () => {
    it('should format room not found message', () => {
      const error = new NotFoundError('/path/to/room');
      expect(error.message).toBe('room not found at: /path/to/room');
      expect(error.path).toBe('/path/to/room');
      expect(error.resourceType).toBe('room');
    });

    it('should format file not found message', () => {
      const error = new NotFoundError('/path/to/file.txt', 'file');
      expect(error.message).toBe('file not found at: /path/to/file.txt');
      expect(error.resourceType).toBe('file');
    });

    it('should format library not found message', () => {
      const error = new NotFoundError('/path/to/datalib.yml', 'library');
      expect(error.message).toBe('library not found at: /path/to/datalib.yml');
    });
  });

  describe('ReadOnlyError', () => {
    it('should format readonly error message', () => {
      const error = new ReadOnlyError('add file');
      expect(error.message).toBe('Cannot add file: room is opened in readonly mode');
      expect(error.operation).toBe('add file');
    });
  });

  describe('OfflineError', () => {
    it('should format offline error message', () => {
      const error = new OfflineError('https://example.com/page');
      expect(error.message).toBe(
        'Cannot fetch https://example.com/page: room is opened in offline mode'
      );
      expect(error.url).toBe('https://example.com/page');
    });
  });

  describe('CacheMissError', () => {
    it('should format cache miss message', () => {
      const error = new CacheMissError('https://Example.COM/Page', 'https://example.com/page');
      expect(error.message).toBe('URL not in cache: https://Example.COM/Page');
      expect(error.url).toBe('https://Example.COM/Page');
      expect(error.normalizedUrl).toBe('https://example.com/page');
    });
  });

  describe('EntryNotFoundError', () => {
    it('should format entry not found message', () => {
      const error = new EntryNotFoundError('file:overview.md');
      expect(error.message).toBe('Entry not found: file:overview.md');
      expect(error.key).toBe('file:overview.md');
    });
  });

  describe('FormatError', () => {
    it('should format version mismatch message', () => {
      const error = new FormatError('DR/0.3', 'DR/0.4');
      expect(error.message).toBe('Incompatible format version: expected DR/0.3, got DR/0.4');
      expect(error.expected).toBe('DR/0.3');
      expect(error.actual).toBe('DR/0.4');
    });
  });

  describe('ValidationError', () => {
    it('should format validation error without issues', () => {
      const error = new ValidationError('Invalid dataroom');
      expect(error.message).toBe('Invalid dataroom');
      expect(error.issues).toEqual([]);
    });

    it('should format validation error with issues', () => {
      const error = new ValidationError('Invalid dataroom', [
        'missing metadata/dataroom.yml',
        'missing files/ directory',
      ]);
      expect(error.message).toBe(
        'Invalid dataroom: missing metadata/dataroom.yml, missing files/ directory'
      );
      expect(error.issues).toHaveLength(2);
    });
  });

  describe('FetchError', () => {
    it('should format fetch error with status', () => {
      const error = new FetchError('https://example.com/api', 404);
      expect(error.message).toBe('Failed to fetch https://example.com/api (status: 404)');
      expect(error.url).toBe('https://example.com/api');
      expect(error.statusCode).toBe(404);
    });

    it('should format fetch error with cause', () => {
      const cause = new Error('Connection refused');
      const error = new FetchError('https://example.com/api', undefined, cause);
      expect(error.message).toBe('Failed to fetch https://example.com/api: Connection refused');
      expect(error.cause).toBe(cause);
    });

    it('should format fetch error with status and cause', () => {
      const cause = new Error('Timeout');
      const error = new FetchError('https://example.com/api', 504, cause);
      expect(error.message).toBe('Failed to fetch https://example.com/api (status: 504): Timeout');
    });
  });

  describe('IndexError', () => {
    it('should format index error', () => {
      const error = new IndexError('corrupted data', '/path/to/index');
      expect(error.message).toBe('Index error in /path/to/index: corrupted data');
      expect(error.indexPath).toBe('/path/to/index');
    });

    it('should format index error with cause', () => {
      const cause = new Error('ENOENT');
      const error = new IndexError('failed to open', '/path/to/index', cause);
      expect(error.message).toBe('Index error in /path/to/index: failed to open: ENOENT');
    });
  });

  describe('SealedRoomError', () => {
    it('should format sealed-miss message with the key', () => {
      const error = new SealedRoomError('url:https://example.com/page');
      expect(error.message).toBe(
        '"url:https://example.com/page" is not cached and the dataroom is sealed (no external operations permitted)'
      );
      expect(error.key).toBe('url:https://example.com/page');
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
});
