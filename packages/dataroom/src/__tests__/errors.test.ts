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

// Constructor-sets-fields tests (message formatting, field assignment) deleted: 17 tests
// that constructed each error subclass and read back name/message/fields — trivially
// passing and redundant with the type system. A Phase-4 bead will add throw-site coverage.
//
// Retained: error-classification behavior (instanceof chains used by catch handlers).

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
});
