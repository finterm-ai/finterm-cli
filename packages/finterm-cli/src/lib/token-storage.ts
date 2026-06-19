/**
 * Token Storage for CLI Authentication
 *
 * Manages storage and retrieval of authentication tokens.
 * Priority order:
 * 1. FINTERM_API_KEY environment variable (for CI/scripts)
 * 2. File storage in ~/.finterm/credentials.json
 *
 * Future: OS keychain support (macOS Keychain, Windows Credential Manager)
 */

import { readFile, chmod, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

import { writeFile } from '../cli/lib/fs.js';

/** Credentials file name */
export const CREDENTIALS_FILENAME = 'credentials.json';

/** Environment variable for token override */
export const TOKEN_ENV_VAR = 'FINTERM_API_KEY';

/**
 * Interface for token storage implementations.
 */
export interface TokenStorage {
  /** Get the stored token, or null if not found */
  getToken(): Promise<string | null>;

  /** Get token metadata for status output */
  getTokenInfo(): Promise<TokenInfo>;

  /** Store a token */
  setToken(token: string, metadata?: TokenMetadata): Promise<void>;

  /** Remove the stored token */
  clearToken(): Promise<void>;

  /** Check if a token is stored */
  hasToken(): Promise<boolean>;
}

/** Where a token came from, so status output can explain precedence to the user. */
export type TokenSource = 'env' | 'file';

export interface TokenMetadata {
  tokenId?: string;
}

/** Token plus provenance, surfaced by `finterm auth status`. */
export interface TokenInfo {
  token: string | null;
  tokenId: string | null;
  source: TokenSource | null;
  storedAt: number | null;
}

/**
 * On-disk credentials shape. The index signature preserves unknown fields written by
 * other/newer CLI versions so a round-trip read-modify-write never drops them.
 */
interface CredentialsFile {
  token?: string;
  tokenId?: string;
  storedAt?: number;
  [key: string]: unknown;
}

/**
 * File-based token storage implementation.
 * Stores tokens in a JSON file.
 */
export class FileTokenStorage implements TokenStorage {
  private readonly credentialsPath: string;

  constructor(baseDir: string) {
    this.credentialsPath = join(baseDir, CREDENTIALS_FILENAME);
  }

  /**
   * Read credentials file, returning empty object if not found or invalid.
   */
  private async readCredentials(): Promise<CredentialsFile> {
    try {
      if (!existsSync(this.credentialsPath)) {
        return {};
      }
      const content = await readFile(this.credentialsPath, 'utf-8');
      return JSON.parse(content) as CredentialsFile;
    } catch {
      // File doesn't exist or is invalid JSON
      return {};
    }
  }

  /**
   * Write credentials file atomically, creating directory if needed.
   */
  private async writeCredentials(credentials: CredentialsFile): Promise<void> {
    const dir = dirname(this.credentialsPath);
    // The credentials file holds a bearer token: keep the directory private (0700) and
    // the file owner-only (0600). Atomic write prevents corruption from interrupted
    // writes. The chmods are defensive — they also tighten a dir/file created before
    // this hardening, since `atomically` can preserve a pre-existing looser mode when
    // it replaces a file.
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(this.credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    await chmod(this.credentialsPath, 0o600).catch(() => undefined);
    await chmod(dir, 0o700).catch(() => undefined);
  }

  async getToken(): Promise<string | null> {
    const credentials = await this.readCredentials();
    return credentials.token ?? null;
  }

  async getTokenInfo(): Promise<TokenInfo> {
    const credentials = await this.readCredentials();
    if (!credentials.token) {
      return { token: null, tokenId: null, source: null, storedAt: null };
    }

    return {
      token: credentials.token,
      tokenId: typeof credentials.tokenId === 'string' ? credentials.tokenId : null,
      source: 'file',
      storedAt: typeof credentials.storedAt === 'number' ? credentials.storedAt : null,
    };
  }

  async setToken(token: string, metadata: TokenMetadata = {}): Promise<void> {
    const credentials = await this.readCredentials();
    credentials.token = token;
    if (metadata.tokenId !== undefined) {
      credentials.tokenId = metadata.tokenId;
    } else {
      delete credentials.tokenId;
    }
    credentials.storedAt = Date.now();
    await this.writeCredentials(credentials);
  }

  async clearToken(): Promise<void> {
    const credentials = await this.readCredentials();
    delete credentials.token;
    delete credentials.tokenId;
    delete credentials.storedAt;
    await this.writeCredentials(credentials);
  }

  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}

/**
 * Token storage that wraps another storage and checks env var first.
 */
class EnvAwareTokenStorage implements TokenStorage {
  constructor(private readonly fallback: TokenStorage) {}

  async getToken(): Promise<string | null> {
    // The env var wins so CI and scripts can override stored credentials.
    const envToken = process.env[TOKEN_ENV_VAR];
    if (envToken) {
      return envToken;
    }
    return this.fallback.getToken();
  }

  async getTokenInfo(): Promise<TokenInfo> {
    const envToken = process.env[TOKEN_ENV_VAR];
    if (envToken) {
      return { token: envToken, tokenId: null, source: 'env', storedAt: null };
    }
    return this.fallback.getTokenInfo();
  }

  async setToken(token: string, metadata: TokenMetadata = {}): Promise<void> {
    // Always write to file storage (env var is read-only)
    return this.fallback.setToken(token, metadata);
  }

  async clearToken(): Promise<void> {
    // Clear file storage (env var is read-only)
    return this.fallback.clearToken();
  }

  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}

/**
 * Create a token storage instance.
 *
 * @param baseDir - The base directory for credentials file
 * @returns Token storage that checks env var first, then file
 */
export function createTokenStorage(baseDir: string): TokenStorage {
  const fileStorage = new FileTokenStorage(baseDir);
  return new EnvAwareTokenStorage(fileStorage);
}
