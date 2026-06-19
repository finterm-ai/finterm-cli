/**
 * Bootstrap proxy support for Node.js native fetch.
 *
 * Node.js native fetch (built on undici) does NOT honor HTTP_PROXY/HTTPS_PROXY
 * environment variables. The `NODE_USE_ENV_PROXY` flag is only available in
 * Node.js 23+. This module uses undici's ProxyAgent + setGlobalDispatcher to
 * route all fetch requests through the proxy when one is configured.
 *
 * Must be called synchronously before any fetch calls are made.
 */

/**
 * Route Node's global fetch through an HTTP(S) proxy when one is configured via the
 * standard proxy environment variables. No-op when no proxy is set; throws with a clear
 * message if the configured proxy URL is malformed.
 */
export async function bootstrapProxy(): Promise<void> {
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  if (proxyUrl) {
    // Lazy: undici is only loaded when a proxy is actually configured, keeping it
    // off the startup path for the common no-proxy case.
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    let agent: InstanceType<typeof ProxyAgent>;
    try {
      // ProxyAgent throws synchronously on a malformed proxy URL.
      agent = new ProxyAgent(proxyUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid proxy configuration (${proxyUrl}): ${message}`);
    }
    setGlobalDispatcher(agent);
  }
}
