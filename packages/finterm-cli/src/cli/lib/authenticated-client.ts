/**
 * Shared authenticated Finterm API client construction for CLI commands.
 */
import { getApiUrl, getFintermDir } from '../../cli-io/settings.js';
import {
  createAPIClient,
  type ApiRequestObserver,
  type FintermAPIClient,
} from '../../lib/api-client.js';
import { createTokenStorage } from '../../lib/token-storage.js';
import { CLIError } from './errors.js';

/**
 * Create an API client with the stored or environment-provided CLI token.
 *
 * Pass `onRequest` (e.g. `BaseCommand.requestLogger()`) to surface `> GET /path`
 * diagnostics at --verbose/--debug level.
 */
export async function getAuthenticatedClient(
  onRequest?: ApiRequestObserver
): Promise<FintermAPIClient> {
  const apiUrl = getApiUrl();
  const client = createAPIClient(apiUrl, undefined, { cacheEnabled: true, onRequest });
  const fintermDir = getFintermDir();
  const tokenStorage = createTokenStorage(fintermDir);
  const token = await tokenStorage.getToken();

  if (!token) {
    throw new CLIError('Not authenticated. Please run `finterm auth login` first.');
  }

  client.setToken(token);
  return client;
}
