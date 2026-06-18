/**
 * Markdown rendering utilities.
 */

import type { marked as markedType } from 'marked';
import type { markedTerminal as markedTerminalType } from 'marked-terminal';

import type { ColorOption } from './context.js';
import { shouldColorize } from './context.js';
import { MAX_HELP_WIDTH } from './output.js';

/**
 * Lazily loaded marked + marked-terminal, memoized across renders.
 *
 * marked-terminal costs ~135ms to import (highlight.js language registration),
 * so it must stay off the startup path; it loads on the first colorized render
 * only. Plain (no-color/piped) rendering never loads it at all.
 */
let markedModulesPromise: Promise<{
  marked: typeof markedType;
  markedTerminal: typeof markedTerminalType;
}> | null = null;

function loadMarkedModules() {
  markedModulesPromise ??= Promise.all([import('marked'), import('marked-terminal')]).then(
    ([markedModule, markedTerminalModule]) => ({
      marked: markedModule.marked,
      markedTerminal: markedTerminalModule.markedTerminal,
    })
  );
  return markedModulesPromise;
}

/**
 * Render Markdown to colorized terminal output.
 *
 * Uses marked-terminal for colorized output when colors are enabled,
 * falls back to plain Markdown when colors are disabled or piped.
 */
export async function renderMarkdown(
  content: string,
  colorOption: ColorOption = 'auto'
): Promise<string> {
  const useColors = shouldColorize(colorOption);

  if (!useColors) {
    // Return plain markdown when colors are disabled
    return content;
  }

  const { marked, markedTerminal } = await loadMarkedModules();

  // Configure marked with terminal renderer for this parse
  marked.use(
    markedTerminal({
      width: Math.min(MAX_HELP_WIDTH, process.stdout.columns || 80),
      reflowText: true,
    }) as unknown as Parameters<typeof marked.use>[0]
  );

  // marked.parse returns string with sync renderer
  return marked.parse(content);
}
