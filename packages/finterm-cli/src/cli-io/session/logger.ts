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

// Re-export CliSession type for convenience
export type { CliSession };

// =============================================================================
// Types
// =============================================================================

/** Options for creating a session logger */
export interface SessionLoggerOptions {
  /** Directory to store log files */
  logDir: string;
  /** Whether to create the directory if it doesn't exist (default: false) */
  createDir: boolean;
}

// =============================================================================
// Default Paths
// =============================================================================

/**
 * Get the default log directory path.
 *
 * @returns Path to ~/.finterm/logs
 */
export function getDefaultLogDir(): string {
  return join(homedir(), '.finterm', 'logs');
}

// =============================================================================
// Session Logger Class
// =============================================================================

/**
 * Logger for CLI sessions.
 */
export class SessionLogger {
  private logDir: string;
  private createDir: boolean;

  constructor(options: SessionLoggerOptions) {
    this.logDir = options.logDir;
    this.createDir = options.createDir;

    // Create directory on construction if requested
    if (this.createDir && !existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Log a CLI session to a file.
   *
   * @param session - The session to log
   * @returns Path to the created log file
   */
  async logSession(session: CliSession): Promise<string> {
    // Ensure directory exists
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
   * List all session log files.
   *
   * @returns Array of log file paths
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
   * Generate a filename for a session log.
   *
   * Format: {date}_{command}_{sessionId}.json
   */
  private generateFilename(session: CliSession): string {
    // Extract date from startTime (YYYY-MM-DD)
    const date = session.startTime.slice(0, 10);
    // Extract time for uniqueness (HH-MM-SS)
    const time = session.startTime.slice(11, 19).replace(/:/g, '-');
    const command = session.command;
    const sessionId = session.sessionId;

    return `${date}_${time}_${command}_${sessionId}.json`;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a session logger.
 *
 * @param options - Logger options
 * @returns SessionLogger instance
 */
export function createSessionLogger(options: SessionLoggerOptions): SessionLogger {
  return new SessionLogger(options);
}
