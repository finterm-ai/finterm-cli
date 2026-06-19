/**
 * Finterm CLI settings and path constants.
 *
 * All paths and settings are defined here for consistency.
 * Follows the pattern of ~/.claude for Claude Code.
 */

import path from 'path';
import os from 'os';
import { mkdir, chmod } from 'fs/promises';
import { existsSync } from 'fs';

// Directory settings

/** Default finterm home directory (like ~/.claude for Claude Code) */
export const DEFAULT_FINTERM_DIR = '.finterm';

/** Subdirectory for session logs */
export const LOGS_SUBDIR = 'logs';

/** Credentials filename */
export const CREDENTIALS_FILENAME = 'credentials.json';

/** User config filename */
export const CONFIG_FILENAME = 'config.yaml';

/** Local bundle run ledger filename */
export const RUN_LEDGER_FILENAME = 'runs.json';

// Token settings

/** Prefix for CLI auth tokens */
export const CLI_TOKEN_PREFIX = 'fint_auth_';

/** Length of random portion after prefix */
export const CLI_TOKEN_RANDOM_LENGTH = 32;

/** Number of prefix chars to store unhashed for DB lookup */
export const CLI_TOKEN_LOOKUP_PREFIX_LENGTH = 8;

/** Full token length (prefix + random) */
export const CLI_TOKEN_FULL_LENGTH = CLI_TOKEN_PREFIX.length + CLI_TOKEN_RANDOM_LENGTH;

/** Prefix for public token IDs (visible in UI/API responses); unified with web (`fint_tok_`) */
export const TOKEN_ID_PREFIX = 'fint_tok_';

/** Length of random hex portion in token IDs */
export const TOKEN_ID_RANDOM_LENGTH = 16;

/** Token expiration in days */
export const CLI_TOKEN_EXPIRATION_DAYS = 90;

/** Token expiration in milliseconds */
export const CLI_TOKEN_EXPIRATION_MS = CLI_TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

// Environment variables

/** Environment variable to override finterm config directory */
export const ENV_FINTERM_CONFIG = 'FINTERM_CONFIG';

/** Environment variable to override auth token (for CI/scripts) */
export const ENV_FINTERM_API_KEY = 'FINTERM_API_KEY';

/** Environment variable for mock mode (testing only: 'live' | 'client' | 'client_error') */
export const ENV_FINTERM_MOCK_MODE = 'FINTERM_MOCK_MODE';

/** Environment variable to override API URL */
export const ENV_FINTERM_API_URL = 'FINTERM_API_URL';

// API settings

/** Default API base URL for the Finterm backend (production) */
export const DEFAULT_API_URL = 'https://api.finterm.ai';

/**
 * Get the API URL, checking environment variable first.
 */
export function getApiUrl(): string {
  return process.env[ENV_FINTERM_API_URL] ?? DEFAULT_API_URL;
}

// Path resolution

/**
 * Get the finterm config directory.
 * Default: ~/.finterm (like ~/.claude for Claude Code)
 */
export function getFintermDir(): string {
  const envValue = process.env[ENV_FINTERM_CONFIG];
  if (envValue && envValue.length > 0) {
    return envValue;
  }
  return path.join(os.homedir(), DEFAULT_FINTERM_DIR);
}

/** Get the logs directory path */
export function getLogsDir(): string {
  return path.join(getFintermDir(), LOGS_SUBDIR);
}

/** Get the credentials file path */
export function getCredentialsPath(): string {
  return path.join(getFintermDir(), CREDENTIALS_FILENAME);
}

/** Get the config file path */
export function getConfigPath(): string {
  return path.join(getFintermDir(), CONFIG_FILENAME);
}

/** Get the local bundle run ledger path */
export function getRunLedgerPath(): string {
  return path.join(getFintermDir(), RUN_LEDGER_FILENAME);
}

// Directory setup

/**
 * Ensure the finterm directory structure exists.
 * Creates:
 * - ~/.finterm/ (or FINTERM_CONFIG override)
 * - ~/.finterm/logs/
 *
 * Called on first CLI run or explicitly via `finterm init`.
 *
 * @returns true on success
 */
export async function ensureFintermDirs(): Promise<boolean> {
  const fintermDir = getFintermDir();
  const logsDir = getLogsDir();

  // ~/.finterm stores the bearer-token credentials file, so keep it private (0700).
  if (!existsSync(logsDir)) {
    await mkdir(logsDir, { recursive: true, mode: 0o700 });
  }
  // Defensive: tighten a pre-existing dir created before this hardening (looser umask).
  await chmod(fintermDir, 0o700).catch(() => undefined);

  return true;
}

// Mock mode

/**
 * Mock modes for the CLI, selected via the mock-mode environment variable.
 * - live: No mocking, real API calls
 * - client: Client-side mocking with canned responses
 * - client_error: Client-side mocking that returns error responses
 */
export type MockMode = 'live' | 'client' | 'client_error';

/** All valid mock modes for finterm-cli */
export const FINTERM_CLI_MOCK_MODES = ['live', 'client', 'client_error'] as const;

/**
 * Get the current mock mode.
 * Default: 'live' (no mocking).
 * Set FINTERM_MOCK_MODE=client for testing with mock data.
 * Set FINTERM_MOCK_MODE=client_error for testing error paths.
 */
export function getMockMode(): MockMode {
  const mode = process.env[ENV_FINTERM_MOCK_MODE];
  if (mode === 'client' || mode === 'client_error') {
    return mode;
  }
  return 'live';
}

/**
 * Check if the CLI is running in mock mode (either success or error).
 * @returns true if FINTERM_MOCK_MODE is client or client_error
 */
export function isMockMode(): boolean {
  return getMockMode() !== 'live';
}

/**
 * Check if the CLI is in error mock mode.
 * @returns true if FINTERM_MOCK_MODE=client_error
 */
export function isMockErrorMode(): boolean {
  return getMockMode() === 'client_error';
}
