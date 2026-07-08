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
import { KEY_ROTATION_LINE, UPGRADE_URL_FALLBACK } from '../lib/human-error.js';
import { getFintermDir, ensureFintermDirs, getApiUrl } from '../../cli-io/settings.js';
import { createTokenStorage, TOKEN_ENV_VAR } from '../../lib/token-storage.js';
import {
  APIRequestError,
  createAPIClient,
  type AccountData,
  type FintermAPIClient,
  type LoginEntitlementSummary,
} from '../../lib/api-client.js';

/** Delay between successive login-status polls. */
const POLL_INTERVAL_MS = 2000;

/** Upper bound on total polling time before giving up on a pending login. */
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

/** Fallback login-session lifetime used when the server does not return an expiry. */
const DEFAULT_SESSION_EXPIRY_MS = 15 * 60 * 1000;

/** Token plus its server-side identifier, returned once a login is authorized. */
interface LoginTokenResult {
  token: string;
  /** Server-side token id; null when the server did not return one. */
  tokenId: string | null;
  /** Plan summary from the authorized poll payload; null on older servers. */
  entitlement: LoginEntitlementSummary | null;
}

/** Render an epoch-ms timestamp as a timezone-stable ISO date (YYYY-MM-DD). */
function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Normalized plan state for rendering, converted from the wire shapes at the
 * boundary: every field is required, and absent wire fields become explicit
 * nulls so no caller can accidentally omit one.
 */
export interface PlanState {
  hasPro: boolean;
  status: string | null;
  trialEndsAt: number | null;
  /** Conversion pointer; null when entitled or when the server sent none. */
  upgradeUrl: string | null;
}

/** Normalize the login-poll entitlement summary (camelCase wire) to PlanState. */
function planStateFromEntitlement(summary: LoginEntitlementSummary): PlanState {
  return {
    hasPro: summary.hasPro,
    status: summary.status,
    trialEndsAt: summary.trialEndsAt,
    upgradeUrl: summary.upgradeUrl ?? null,
  };
}

/** Normalize the `/api/v1/account` payload (snake_case wire) to PlanState. */
function planStateFromAccount(account: AccountData): PlanState {
  return {
    hasPro: account.has_pro,
    status: account.subscription_status,
    trialEndsAt: account.trial_ends_at,
    upgradeUrl: account.upgrade_url ?? null,
  };
}

/**
 * The plan line for login/status output (funnel spec C2/C4): free accounts get
 * the upgrade pointer; entitled accounts see their plan/trial state. Offer
 * terms are never stated here — the pricing page owns them, so offer changes
 * never require a CLI release. Exported for tests.
 */
export function planStateLines(plan: PlanState): string[] {
  if (!plan.hasPro) {
    const upgradeUrl = plan.upgradeUrl ?? UPGRADE_URL_FALLBACK;
    if (plan.status === 'past_due' || plan.status === 'unpaid') {
      return [
        'Plan: payment failed — API access is paused.',
        `Update your card to restore access: ${upgradeUrl}`,
      ];
    }
    return ['Plan: free — API access requires Pro.', `Upgrade: ${upgradeUrl}`];
  }
  if (plan.status === 'trialing' && plan.trialEndsAt) {
    return [`Plan: Pro (trial ends ${isoDate(plan.trialEndsAt)})`];
  }
  return ['Plan: Pro'];
}

/** Normalized login options after coercing raw Commander values to concrete types. */
interface AuthLoginOptions {
  browser: boolean;
  deviceName: string | null;
}

/**
 * Raw login options as Commander hands them over, before validation/coercion.
 * Values are `unknown` because the negated `--no-browser` flag and the optional
 * `--device-name` may be absent or of the wrong type.
 */
interface RawAuthLoginOptions {
  browser: unknown;
  deviceName: unknown;
}

/** Show only the head and tail of a token so it can be displayed without leaking it. */
function maskToken(token: string): string {
  return `${token.substring(0, 12)}...${token.substring(token.length - 4)}`;
}

function normalizeLoginOptions(options: RawAuthLoginOptions): AuthLoginOptions {
  return {
    browser: options.browser !== false,
    deviceName: typeof options.deviceName === 'string' ? options.deviceName : null,
  };
}

/**
 * Drives the browser-based login flow: starts a session, opens the login URL,
 * then polls until the user authorizes and a token can be stored locally.
 */
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

    await ensureFintermDirs();

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

    const sessionExpiry = expiresAt ?? Date.now() + DEFAULT_SESSION_EXPIRY_MS;

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

    if (browser) {
      this.output.info('Opening browser...');
      try {
        // Lazy load to keep the common CLI startup chunk free of browser-opening code.
        const { default: open } = await import('open');
        await open(loginUrl);
        this.output.notice('Browser opened. Waiting for authentication...');
      } catch (error) {
        // Browser open is expected to fail in headless/CI environments; fall back to
        // asking the user to open the URL manually rather than aborting the login.
        const reason = error instanceof Error ? error.message : String(error);
        this.output.notice(
          `Could not open browser automatically (${reason}). Please open the URL manually.`
        );
      }
    } else {
      this.output.notice('Waiting for authentication...');
    }

    const tokenResult = await this.pollForToken(sessionId, pollSecret, sessionExpiry);

    if (!tokenResult) {
      throw new CLIError('Login timed out or was denied. Please try again.');
    }

    await tokenStorage.setToken(tokenResult.token, { tokenId: tokenResult.tokenId });

    const entitlement = tokenResult.entitlement;
    this.output.data(
      {
        authenticated: true,
        tokenId: tokenResult.tokenId,
        entitlement,
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
        // Plan-aware close (funnel spec C2): free logins get the upgrade
        // pointer, entitled logins their plan/trial state; older servers
        // without the poll entitlement fall back to the generic line.
        const plan = entitlement ? planStateFromEntitlement(entitlement) : null;
        if (plan && !plan.hasPro) {
          console.log(`Not on Pro yet? Upgrade: ${plan.upgradeUrl ?? UPGRADE_URL_FALLBACK}`);
        } else if (plan) {
          for (const line of planStateLines(plan)) {
            console.log(line);
          }
          console.log('You can now use finterm commands that require authentication.');
        } else {
          console.log('You can now use finterm commands that require authentication.');
        }
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
        if (Date.now() > expiresAt) {
          spinner.stop();
          return null;
        }

        try {
          const response = await this.apiClient.loginPoll(sessionId, pollSecret);

          if (!response.success) {
            await this.sleep(POLL_INTERVAL_MS);
            continue;
          }

          switch (response.status) {
            case 'authorized':
              if (response.token) {
                spinner.stop();
                return {
                  token: response.token,
                  tokenId: response.tokenId ?? null,
                  entitlement: response.entitlement ?? null,
                };
              }
              // Authorized but the token was already consumed by another retrieval;
              // the session is spent, so stop rather than poll forever.
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
              break;

            default:
              // Tolerate unknown statuses from a newer server by logging and continuing.
              this.output.info(`Unexpected poll status: ${response.status}`);
              break;
          }
        } catch (error) {
          // A single failed poll is usually transient (network blip); keep retrying
          // until the overall timeout is reached.
          this.output.info(`Poll error: ${error instanceof Error ? error.message : String(error)}`);
        }

        await this.sleep(POLL_INTERVAL_MS);
      }

      spinner.stop();
      this.output.warn('Login timed out. Please try again.');
      return null;
    } finally {
      spinner.stop();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Whether the user explicitly opted out of interactive prompts. The browser login
   * flow is impossible without interaction, so this gates a clear up-front error.
   */
  private isExplicitlyNonInteractive(): boolean {
    const options = this.command.optsWithGlobals();
    return options.nonInteractive === true;
  }
}

/** Outcome of the server-side credential/entitlement check behind `auth status`. */
type ServerCheck =
  | { state: 'ok'; account: AccountData }
  | { state: 'invalid_token'; code: string }
  | { state: 'unavailable'; reason: string };

/**
 * Reports authentication state, masking the token value. With a stored
 * credential it performs a server entitlement check (`GET /api/v1/account`,
 * funnel spec C4) and reports the account email and plan/trial state \u2014 so a
 * free-plan user learns WHY calls 402, and a rotated-away key is reported as
 * invalid instead of a false "Authenticated". The local credential readout
 * remains as the offline fallback.
 */
class AuthStatusHandler extends BaseCommand {
  async run(): Promise<void> {
    const fintermDir = getFintermDir();
    const tokenStorage = createTokenStorage(fintermDir);
    const tokenInfo = await tokenStorage.getTokenInfo();

    if (!tokenInfo.token) {
      this.output.data({ authenticated: false }, () => {
        const colors = this.output.getColors();
        console.log(`${colors.warn('\u2717')} Not authenticated`);
        console.log('');
        console.log('Run `finterm auth login` to authenticate.');
      });
      return;
    }

    const maskedToken = maskToken(tokenInfo.token);
    const check = await this.checkServer(tokenInfo.token);

    if (check.state === 'invalid_token') {
      // The credential exists locally but the server rejects it \u2014 most often
      // key rotation (funnel spec C3): one active key per account.
      this.output.data(
        {
          authenticated: false,
          token: maskedToken,
          tokenId: tokenInfo.tokenId,
          source: tokenInfo.source,
          serverCheck: 'invalid_token',
          code: check.code,
        },
        () => {
          const colors = this.output.getColors();
          console.log(`${colors.warn('\u2717')} Stored credential is no longer valid`);
          console.log(`  Token: ${maskedToken}`);
          console.log(`  ${KEY_ROTATION_LINE}`);
          console.log('');
          console.log('Run `finterm auth login` to re-authenticate.');
        }
      );
      return;
    }

    const account = check.state === 'ok' ? check.account : null;
    this.output.data(
      {
        authenticated: true,
        token: maskedToken,
        tokenId: tokenInfo.tokenId,
        source: tokenInfo.source,
        serverCheck: check.state === 'ok' ? 'ok' : 'unavailable',
        account,
      },
      () => {
        const colors = this.output.getColors();
        console.log(`${colors.success('\u2713')} Authenticated`);
        if (account?.email) {
          console.log(`  Account: ${account.email}`);
        }
        console.log(`  Token: ${maskedToken}`);
        console.log(
          `  Source: ${tokenInfo.source === 'env' ? 'FINTERM_API_KEY' : 'credentials file'}`
        );
        if (tokenInfo.tokenId) {
          console.log(`  Token ID: ${tokenInfo.tokenId}`);
        } else if (tokenInfo.source === 'env') {
          console.log('  Token ID: unavailable for FINTERM_API_KEY');
        }
        if (account) {
          for (const line of planStateLines(planStateFromAccount(account))) {
            console.log(`  ${line}`);
          }
        } else if (check.state === 'unavailable') {
          console.log(
            colors.dim(`  Plan: unknown \u2014 server check unavailable (${check.reason}).`)
          );
        }
      }
    );
  }

  /** Run the account read, classifying failures as invalid-token vs unreachable. */
  private async checkServer(token: string): Promise<ServerCheck> {
    try {
      const client = createAPIClient(getApiUrl(), token, {
        cacheEnabled: false,
        onRequest: this.requestLogger(),
      });
      const response = await client.account();
      if (response.data) {
        return { state: 'ok', account: response.data };
      }
      return {
        state: 'unavailable',
        reason: response.error?.message ?? 'unexpected response shape',
      };
    } catch (error) {
      if (error instanceof APIRequestError && error.status === 401) {
        return { state: 'invalid_token', code: error.code ?? 'TOKEN_INVALID' };
      }
      return {
        state: 'unavailable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** Clears the stored authentication token, treating "not logged in" as a no-op success. */
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

const loginCommand = new Command('login')
  .description(
    'Authenticate with the Finterm platform before running point tools or company-research bundles'
  )
  .option('--no-browser', 'Do not automatically open browser')
  .option('--device-name <name>', 'Device name for this login')
  .action(async (options, command) => {
    const handler = new AuthLoginHandler(command);
    await handler.run(normalizeLoginOptions(options));
  });

const statusCommand = new Command('status')
  .description('Check current authentication status for Finterm data access')
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
  .description('Login and token commands for authenticated Finterm data access')
  .addCommand(loginCommand)
  .addCommand(statusCommand)
  .addCommand(logoutCommand);
