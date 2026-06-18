/**
 * Session logger.
 *
 * Logs CLI sessions to ~/.finterm/logs/ for debugging and golden test support.
 */

import { mkdir, readdir } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFile } from 'atomically';
import type { CliSession } from './schemas';

export type { CliSession };

/** Options for creating a session logger */
export interface SessionLoggerOptions {
  /** Directory to store log files */
  logDir: string;
  /** Whether to create the directory if it doesn't exist (default: false) */
  createDir: boolean;
}

/**
 * Default log directory (`~/.finterm/logs`).
 */
export function getDefaultLogDir(): string {
  return join(homedir(), '.finterm', 'logs');
}

/**
 * Writes each CLI session to its own JSON file under a log directory, for
 * debugging and golden-test capture. Can create the directory on demand.
 */
export class SessionLogger {
  private logDir: string;
  private createDir: boolean;

  constructor(options: SessionLoggerOptions) {
    this.logDir = options.logDir;
    this.createDir = options.createDir;

    if (this.createDir && !existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Write a session to a new log file and return its path. Throws if the log
   * directory is missing and this logger was not configured to create it.
   */
  async logSession(session: CliSession): Promise<string> {
    if (!existsSync(this.logDir)) {
      if (this.createDir) {
        await mkdir(this.logDir, { recursive: true });
      } else {
        throw new Error(`Log directory does not exist: ${this.logDir}`);
      }
    }

    const filename = this.generateFilename(session);
    const filePath = join(this.logDir, filename);

    const content = JSON.stringify(session, null, 2);
    await writeFile(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * List the paths of all session log files, sorted (which, given the timestamp
   * filename prefix, also orders them chronologically).
   */
  async listLogs(): Promise<string[]> {
    if (!existsSync(this.logDir)) {
      return [];
    }

    const files = await readdir(this.logDir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(this.logDir, f))
      .sort();
  }

  /**
   * Build a `{date}_{time}_{command}_{sessionId}.json` filename. The leading
   * date and time keep logs sortable; the session id keeps them unique.
   */
  private generateFilename(session: CliSession): string {
    // Slice the ISO startTime into date (YYYY-MM-DD) and colon-free time (HH-MM-SS).
    const date = session.startTime.slice(0, 10);
    const time = session.startTime.slice(11, 19).replace(/:/g, '-');
    const command = session.command;
    const sessionId = session.sessionId;

    return `${date}_${time}_${command}_${sessionId}.json`;
  }
}

/**
 * Create a session logger.
 */
export function createSessionLogger(options: SessionLoggerOptions): SessionLogger {
  return new SessionLogger(options);
}
