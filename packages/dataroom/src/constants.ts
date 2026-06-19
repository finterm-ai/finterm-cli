/** Constants for the database-free DR/0.3 profile:file dataroom core. */

/** Public launch format for file-profile rooms delivered as object-synced files. */
export const FILE_PROFILE_FORMAT_VERSION = 'DR/0.3';

/** Public launch room profile: file tree plus managed `data/`, no required catalog DB. */
export const ROOM_PROFILE_FILE = 'file';

/** User-visible artifact files inside a profile:file room. */
export const FILES_DIR = 'files';

/** Managed machine-readable data inside a profile:file room. */
export const DATA_DIR = 'data';

/** Managed binary payloads under `data/` for producers that need them. */
export const DATA_BLOBS_DIR = 'data/blobs';

/** Room manifest file. */
export const ROOM_METADATA_FILE = 'dataroom.yml';

/** Default values for file-profile reads and internal producer adapters. */
export const DEFAULTS = {
  /** Default concurrency for producer batch URL fetching. */
  FETCH_CONCURRENCY: 5,
  /** Default timeout for producer URL fetches in milliseconds. */
  FETCH_TIMEOUT_MS: 30000,
  /** Default bounded artifact read size for agent-facing operations. */
  AGENT_READ_MAX_BYTES: 20000,
} as const;
