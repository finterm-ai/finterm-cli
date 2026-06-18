import { describe, it, expect } from 'vitest';

import {
  DATA_BLOBS_DIR,
  DATA_DIR,
  FILE_PROFILE_FORMAT_VERSION,
  FILES_DIR,
  ROOM_METADATA_FILE,
  ROOM_PROFILE_FILE,
} from '../constants.js';

describe('constants', () => {
  it('exposes the DR/0.3 file-profile launch constants', () => {
    expect(FILE_PROFILE_FORMAT_VERSION).toBe('DR/0.3');
    expect(ROOM_PROFILE_FILE).toBe('file');
    expect(ROOM_METADATA_FILE).toBe('dataroom.yml');
    expect(FILES_DIR).toBe('files');
    expect(DATA_DIR).toBe('data');
    expect(DATA_BLOBS_DIR).toBe('data/blobs');
  });
});
