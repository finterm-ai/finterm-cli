/**
 * Version constant injected at build time.
 *
 * See: research-modern-typescript-cli-patterns.md#8-version-handling
 */

// Declare the build-time constant (injected by tsdown.config.ts)
declare const __FINTERM_VERSION__: string;

/**
 * CLI version string.
 * Format: <package-version>+g<commit>[-dirty]
 */
export const VERSION: string =
  typeof __FINTERM_VERSION__ !== 'undefined' ? __FINTERM_VERSION__ : '0.0.0-dev';
