import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CREDENTIALS_FILENAME, TOKEN_ENV_VAR, createTokenStorage } from './token-storage.js';

const isWindows = process.platform === 'win32';

describe('token storage', () => {
  let baseDir: string;
  let credentialsPath: string;
  const savedEnv = process.env[TOKEN_ENV_VAR];

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'finterm-token-'));
    credentialsPath = join(baseDir, CREDENTIALS_FILENAME);
    delete process.env[TOKEN_ENV_VAR];
  });

  afterEach(async () => {
    if (savedEnv === undefined) {
      delete process.env[TOKEN_ENV_VAR];
    } else {
      process.env[TOKEN_ENV_VAR] = savedEnv;
    }
    await rm(baseDir, { recursive: true, force: true });
  });

  it('writes the token to the credentials file and reads it back', async () => {
    const storage = createTokenStorage(baseDir);

    await storage.setToken('secret-token', { tokenId: 'tok_123' });

    expect(existsSync(credentialsPath)).toBe(true);
    expect(await storage.getToken()).toBe('secret-token');

    const info = await storage.getTokenInfo();
    expect(info.token).toBe('secret-token');
    expect(info.tokenId).toBe('tok_123');
    expect(info.source).toBe('file');
    expect(typeof info.storedAt).toBe('number');
  });

  it('creates the credentials file with mode 0600 and its parent dir with mode 0700', async () => {
    const storage = createTokenStorage(baseDir);

    await storage.setToken('secret-token', { tokenId: null });

    if (isWindows) {
      // POSIX permission bits are not meaningful on win32.
      return;
    }

    const fileMode = statSync(credentialsPath).mode & 0o777;
    const dirMode = statSync(baseDir).mode & 0o777;

    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  it('reads the env override but never writes it to disk', async () => {
    process.env[TOKEN_ENV_VAR] = 'env-token';
    const storage = createTokenStorage(baseDir);

    // The env override takes priority for reads.
    expect(await storage.getToken()).toBe('env-token');

    const info = await storage.getTokenInfo();
    expect(info.token).toBe('env-token');
    expect(info.source).toBe('env');

    // Reading the env override must not create or populate the on-disk file.
    expect(existsSync(credentialsPath)).toBe(false);
  });

  it('does not persist the env override value when a token is written to file', async () => {
    process.env[TOKEN_ENV_VAR] = 'env-token';
    const storage = createTokenStorage(baseDir);

    await storage.setToken('file-token', { tokenId: null });

    // The file on disk holds only the explicitly written token, not the env value.
    const contents = await readFile(credentialsPath, 'utf-8');
    expect(contents).toContain('file-token');
    expect(contents).not.toContain('env-token');

    // With the env override removed, the file token is what surfaces.
    delete process.env[TOKEN_ENV_VAR];
    expect(await storage.getToken()).toBe('file-token');
  });
});
