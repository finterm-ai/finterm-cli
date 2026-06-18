/**
 * `finterm auth` - Authentication commands for Finterm CLI.
 *
 * Subcommands:
 * - login: Authenticate with the Finterm platform
 * - status: Check current authentication status
 * - logout: Clear stored authentication token
 */

import { Command } from 'commander';

import { BaseCommand } from '../lib/base-command.js';
import { CLIError } from '../lib/errors.js';
import { getFintermDir, ensureFintermDirs, getApiUrl } from '../../cli-io/settings.js';
import { createTokenStorage, TOKEN_ENV_VAR } from '../../lib/token-storage.js';
import { createAPIClient, type FintermAPIClient } from '../../lib/api-client.js';

/** Poll interval in milliseconds */
const POLL_INTERVAL_MS = 2000;

/** Maximum poll duration in milliseconds (10 minutes) */
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

interface LoginTokenResult {
  token: string;
  tokenId?: string;
}

interface AuthLoginOptions {
  browser: boolean;
  deviceName: string | null;
}

interface RawAuthLoginOptions {
  browser: unknown;
  deviceName: unknown;
}

function maskToken(token: string): string {
  return `${token.substring(0, 12)}...${token.substring(token.length - 4)}`;
}

function normalizeLoginOptions(options: RawAuthLoginOptions): AuthLoginOptions {
  return {
    browser: options.browser !== false,
    deviceName: typeof options.deviceName === 'string' ? options.deviceName : null,
  };
}

// =============================================================================
// Auth Login Handler
// =============================================================================

class AuthLoginHandler extends BaseCommand {
  private apiClient: FintermAPIClient;
  private command: Command;

  constructor(command: Command) {
    super(command);
    this.command = command;
    this.apiClient = createAPIClient(getApiUrl(), undefined, {
      cacheEnabled: true,
      onRequest: this.requestLogger(),
    });
  }

  async run(options: AuthLoginOptions): Promise<void> {
    const { browser, deviceName } = options;

    // Ensure directories exist
    await ensureFintermDirs();

    // Check if already logged in
    const fintermDir = getFintermDir();
    const tokenStorage = createTokenStorage(fintermDir);
    const existingToken = await tokenStorage.getToken();

    if (this.isExplicitlyNonInteractive() && !existingToken) {
      throw new CLIError(
        `finterm auth login requires a browser flow. In --non-interactive mode, set ${TOKEN_ENV_VAR}=fint_auth_... instead.`
      );
    }

    if (existingToken) {
      this.output.notice(
        'Signing in again creates a new API key and revokes the previous active key.'
      );
    } else {
      this.output.notice('Signing in creates a new API key and revokes any previous active key.');
    }

    // Start login flow
    this.output.info('Starting login flow...');

    const startResponse = await this.execute(
      () => this.apiClient.loginStart(deviceName ?? `CLI - ${process.platform}`),
      'Failed to start login'
    );

    if (
      !startResponse.success ||
      !startResponse.sessionId ||
      !startResponse.pollSecret ||
      !startResponse.loginUrl
    ) {
      const errorMsg = startResponse.error?.message ?? 'Failed to start login session';
      throw new CLIError(errorMsg);
    }

    const { sessionId, pollSecret, loginUrl, expiresAt } = startResponse;

    // Default expiry to 15 minutes if not provided
    const sessionExpiry = expiresAt ?? Date.now() + 15 * 60 * 1000;

    // Show login instructions
    this.output.data(
      {
        sessionId,
        loginUrl,
        expiresAt: sessionExpiry,
        rotation: 'single-active-key',
        message: 'Please complete login in your browser',
      },
      () => {
        console.log('');
        console.log('To complete login, open this URL in your browser:');
        console.log('');
        console.log(`  ${loginUrl}`);
        console.log('');
      }
    );

    // Open browser unless --no-browser was passed
    if (browser) {
      this.output.info('Opening browser...');
      try {
        // Lazy load to keep the common CLI startup chunk free of browser-opening code.
        const { default: open } = await import('open');
        await open(loginUrl);
        this.output.notice('Browser opened. Waiting for authentication...');
      } catch (error) {
        // Browser open can fail for various reasons (no default browser, permissions, etc.)
        // This is expected in headless/CI environments - provide helpful fallback message
        const reason = error instanceof Error ? error.message : String(error);
        this.output.notice(
          `Could not open browser automatically (${reason}). Please open the URL manually.`
        );
      }
    } else {
      this.output.notice('Waiting for authentication...');
    }

    // Poll for completion
    const tokenResult = await this.pollForToken(sessionId, pollSecret, sessionExpiry);

    if (!tokenResult) {
      throw new CLIError('Login timed out or was denied. Please try again.');
    }

    // Save token
    await tokenStorage.setToken(tokenResult.token, { tokenId: tokenResult.tokenId });

    this.output.data(
      {
        authenticated: true,
        tokenId: tokenResult.tokenId ?? null,
        message: 'Successfully logged in',
      },
      () => {
        const colors = this.output.getColors();
        console.log('');
        console.log(`${colors.success('\u2713')} Successfully logged in!`);
        if (tokenResult.tokenId) {
          console.log(`  Token ID: ${tokenResult.tokenId}`);
        }
        console.log('');
        console.log('You can now use finterm commands that require authentication.');
      }
    );
  }

  /**
   * Poll the login status until authorized, denied, or timeout.
   * Uses spinner in text mode, silent in JSON mode.
   */
  private async pollForToken(
    sessionId: string,
    pollSecret: string,
    expiresAt: number
  ): Promise<LoginTokenResult | null> {
    const startTime = Date.now();
    const spinner = this.output.spinner('Waiting for authentication');

    try {
      while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
        // Check if session expired
        if (Date.now() > expiresAt) {
          spinner.stop();
          return null;
        }

        try {
          const response = await this.apiClient.loginPoll(sessionId, pollSecret);

          if (!response.success) {
            // Error polling - wait and retry
            await this.sleep(POLL_INTERVAL_MS);
            continue;
          }

          switch (response.status) {
            case 'authorized':
              if (response.token) {
                spinner.stop();
                return { token: response.token, tokenId: response.tokenId };
              }
              // Token already retrieved or missing - session is done (ar-agfi fix)
              spinner.stop();
              this.output.warn('Session authorized but token was already retrieved.');
              return null;

            case 'denied':
              spinner.stop();
              this.output.warn('Login was denied.');
              return null;

            case 'expired':
              spinner.stop();
              this.output.warn('Login session expired.');
              return null;

            case 'pending':
              // Still waiting - spinner handles progress indication
              break;

            default:
              // Unexpected status - log and keep polling (ar-agfi fix)
              this.output.info(`Unexpected poll status: ${response.status}`);
              break;
          }
        } catch (error) {
          // Network error - wait and retry
          this.output.info(`Poll error: ${error instanceof Error ? error.message : String(error)}`);
        }

        await this.sleep(POLL_INTERVAL_MS);
      }

      spinner.stop();
      this.output.warn('Login timed out. Please try again.');
      return null;
    } finally {
      // Ensure spinner is always stopped
      spinner.stop();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isExplicitlyNonInteractive(): boolean {
    const options = this.command.optsWithGlobals();
    return options.nonInteractive === true;
  }
}

// =============================================================================
// Auth Status Handler
// =============================================================================

class AuthStatusHandler extends BaseCommand {
  async run(): Promise<void> {
    const fintermDir = getFintermDir();
    const tokenStorage = createTokenStorage(fintermDir);
    const tokenInfo = await tokenStorage.getTokenInfo();

    if (tokenInfo.token) {
      const maskedToken = maskToken(tokenInfo.token);

      this.output.data(
        {
          authenticated: true,
          token: maskedToken,
          tokenId: tokenInfo.tokenId,
          source: tokenInfo.source,
        },
        () => {
          const colors = this.output.getColors();
          console.log(`${colors.success('\u2713')} Authenticated`);
          console.log(`  Token: ${maskedToken}`);
          console.log(
            `  Source: ${tokenInfo.source === 'env' ? 'FINTERM_API_KEY' : 'credentials file'}`
          );
          if (tokenInfo.tokenId) {
            console.log(`  Token ID: ${tokenInfo.tokenId}`);
          } else if (tokenInfo.source === 'env') {
            console.log('  Token ID: unavailable for FINTERM_API_KEY');
          }
        }
      );
    } else {
      this.output.data({ authenticated: false }, () => {
        const colors = this.output.getColors();
        console.log(`${colors.warn('\u2717')} Not authenticated`);
        console.log('');
        console.log('Run `finterm auth login` to authenticate.');
      });
    }
  }
}

// =============================================================================
// Auth Logout Handler
// =============================================================================

class AuthLogoutHandler extends BaseCommand {
  async run(): Promise<void> {
    const fintermDir = getFintermDir();
    const tokenStorage = createTokenStorage(fintermDir);
    const hasToken = await tokenStorage.hasToken();

    if (!hasToken) {
      this.output.data(
        { loggedOut: true, wasLoggedIn: false, message: 'Not currently logged in' },
        () => {
          console.log('Not currently logged in. Nothing to do.');
        }
      );
      return;
    }

    if (this.checkDryRun('Would clear stored authentication token')) {
      return;
    }

    await tokenStorage.clearToken();

    this.output.data(
      { loggedOut: true, wasLoggedIn: true, message: 'Successfully logged out' },
      () => {
        const colors = this.output.getColors();
        console.log(`${colors.success('\u2713')} Successfully logged out.`);
      }
    );
  }
}

// =============================================================================
// Command Definition
// =============================================================================

const loginCommand = new Command('login')
  .description('Authenticate with the Finterm platform before running company research bundles')
  .option('--no-browser', 'Do not automatically open browser')
  .option('--device-name <name>', 'Device name for this login')
  .action(async (options, command) => {
    const handler = new AuthLoginHandler(command);
    await handler.run(normalizeLoginOptions(options));
  });

const statusCommand = new Command('status')
  .description('Check current authentication status for bundle research')
  .action(async (_options, command) => {
    const handler = new AuthStatusHandler(command);
    await handler.run();
  });

const logoutCommand = new Command('logout')
  .description('Clear stored authentication token')
  .action(async (_options, command) => {
    const handler = new AuthLogoutHandler(command);
    await handler.run();
  });

export const authCommand = new Command('auth')
  .description('Login and token commands for authenticated company research')
  .addCommand(loginCommand)
  .addCommand(statusCommand)
  .addCommand(logoutCommand);
