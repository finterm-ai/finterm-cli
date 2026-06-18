/**
 * Shared base class for document listing/lookup commands.
 *
 * Used by shortcut, resources, and form commands to provide
 * consistent behavior for --list, fuzzy search, and exact match.
 */

import type { Command } from 'commander';

import { BaseCommand } from './base-command.js';
import { DocCache, SCORE_PREFIX_MATCH } from './doc-cache.js';
import { getTerminalWidth } from './output.js';

/**
 * Configuration for a doc command handler.
 */
export interface DocCommandConfig {
  /** Display name for the doc type (e.g., "shortcut", "resource", "form") */
  typeName: string;
  /**
   * CLI command word that retrieves a doc (e.g., "shortcut", "resources").
   * Listings print the full runnable command (`finterm <commandName> <name>`)
   * so an agent can copy-run an entry without a second lookup.
   */
  commandName: string;
  /** Plural display name (e.g., "shortcuts", "resources", "forms") */
  typeNamePlural: string;
  /** Paths to search for documents (relative to baseDir) */
  paths: string[];
  /** Base directory for resolving paths */
  baseDir: string;
  /** Names to exclude from listings (e.g., system docs) */
  excludeFromList?: string[];
  /** Header text to show before document output (optional) */
  agentHeader?: string;
}

/**
 * Common options for doc commands.
 */
export interface DocCommandOptions {
  list: boolean;
  all: boolean;
  category?: string;
  quiet: boolean;
}

/**
 * Base handler for document commands (shortcut, resources, form).
 *
 * Provides shared functionality for:
 * - Listing documents with --list
 * - Exact name lookup
 * - Fuzzy search
 * - Wrapped description output
 */
export abstract class DocCommandHandler extends BaseCommand {
  protected cache: DocCache | null = null;

  constructor(
    command: Command,
    protected readonly config: DocCommandConfig
  ) {
    super(command);
  }

  /**
   * Initialize the doc cache. Must be called before other operations.
   */
  protected async initCache(): Promise<void> {
    this.cache = new DocCache(this.config.paths, this.config.baseDir);
    await this.cache.load({ quiet: this.ctx.quiet });
  }

  /**
   * Handle --list mode: show all available documents.
   */
  protected async handleList(includeAll = false, category?: string): Promise<void> {
    if (!this.cache) throw new Error('Cache not initialized');

    let docs = this.cache.list(includeAll);

    // Filter by category if specified
    if (category) {
      docs = docs.filter((d) => d.frontmatter?.category === category);
    }

    // Filter excluded names
    if (this.config.excludeFromList) {
      const excludeSet = new Set(this.config.excludeFromList);
      docs = docs.filter((d) => !excludeSet.has(d.name));
    }

    if (this.ctx.json) {
      this.output.data(
        docs.map((d) => ({
          name: d.name,
          title: d.frontmatter?.title,
          description: d.frontmatter?.description,
          category: d.frontmatter?.category,
          path: d.path,
          sourceDir: d.sourceDir,
          sizeBytes: d.sizeBytes,
          approxTokens: d.approxTokens,
          shadowed: this.cache!.isShadowed(d),
        }))
      );
      return;
    }

    if (docs.length === 0) {
      console.log(`No ${this.config.typeNamePlural} found.`);
      return;
    }

    const maxWidth = getTerminalWidth();

    for (const doc of docs) {
      const shadowed = this.cache.isShadowed(doc);
      const name = doc.name;
      const title = doc.frontmatter?.title;
      const description = doc.frontmatter?.description ?? this.extractFallbackText(doc.content);

      const colors = this.output.getColors();
      if (shadowed) {
        // Muted style for shadowed entries
        const line = `finterm ${this.config.commandName} ${name} (${doc.sourceDir}) [shadowed]`;
        console.log(colors.dim(this.truncate(line, maxWidth)));
      } else {
        // Line 1: runnable command (bold) + size/token info (dimmed)
        const sizeInfo = this.formatDocSize(doc.sizeBytes, doc.approxTokens);
        console.log(
          `${colors.heading(`finterm ${this.config.commandName} ${name}`)} ${colors.dim(sizeInfo)}`
        );

        // Line 2+: Indented "Title: Description"
        const hasFrontmatter = title ?? doc.frontmatter?.description;
        const content =
          title && description ? `${title}: ${description}` : (title ?? description ?? '');
        if (content) {
          this.printWrappedDescription(content, maxWidth, !hasFrontmatter);
        }
      }
    }
  }

  /**
   * Handle no query: show explanation + help.
   */
  protected async handleNoQuery(): Promise<void> {
    const { typeName, typeNamePlural } = this.config;
    console.log(`finterm ${typeNamePlural} - Find and output ${typeNamePlural}`);
    console.log('');
    console.log('Usage:');
    console.log(`  finterm ${typeNamePlural} <name>           Find ${typeName} by exact name`);
    console.log(`  finterm ${typeNamePlural} <description>    Find ${typeName} by fuzzy match`);
    console.log(
      `  finterm ${typeNamePlural} --list           List all available ${typeNamePlural}`
    );
    console.log(`  finterm ${typeNamePlural} --list --all     Include shadowed ${typeNamePlural}`);
  }

  /**
   * Handle query: exact match first, then fuzzy.
   */
  protected async handleQuery(query: string): Promise<void> {
    if (!this.cache) throw new Error('Cache not initialized');

    // Try exact match first
    const exactMatch = this.cache.get(query);
    if (exactMatch) {
      if (this.ctx.json) {
        this.output.data({
          name: exactMatch.doc.name,
          title: exactMatch.doc.frontmatter?.title,
          score: exactMatch.score,
          content: exactMatch.doc.content,
        });
      } else {
        if (this.config.agentHeader) {
          console.log(this.config.agentHeader + '\n');
        }
        console.log(exactMatch.doc.content);
      }
      return;
    }

    // Fuzzy match
    const matches = this.cache.search(query, 5);
    if (matches.length === 0) {
      console.log(`No ${this.config.typeName} found matching: ${query}`);
      console.log(
        `Run \`finterm ${this.config.typeNamePlural} --list\` to see available ${this.config.typeNamePlural}.`
      );
      return;
    }

    const best = matches[0]!;
    // Use PREFIX_MATCH (0.9) as threshold for high confidence
    if (best.score < SCORE_PREFIX_MATCH) {
      // Low confidence - show suggestions instead
      console.log(`No exact match for "${query}". Did you mean:`);
      for (const m of matches) {
        const name = m.doc.frontmatter?.title ?? m.doc.name;
        console.log(`  ${name} ${this.output.getColors().dim(`(score: ${m.score.toFixed(2)})`)}`);
      }
      return;
    }

    // Good fuzzy match - output it
    if (this.ctx.json) {
      this.output.data({
        name: best.doc.name,
        title: best.doc.frontmatter?.title,
        score: best.score,
        content: best.doc.content,
      });
    } else {
      if (this.config.agentHeader) {
        console.log(this.config.agentHeader + '\n');
      }
      console.log(best.doc.content);
    }
  }

  /**
   * Extract fallback text from content when no frontmatter description exists.
   */
  protected extractFallbackText(content: string): string | undefined {
    // Strip YAML frontmatter if present
    let text = content;
    if (text.startsWith('---')) {
      const endIndex = text.indexOf('---', 3);
      if (endIndex !== -1) {
        text = text.slice(endIndex + 3);
      }
    }

    // Strip markdown headers (# Title -> Title)
    text = text.replace(/^#+\s*/gm, '');
    // Strip bold/italic markers
    text = text.replace(/\*\*|__|\*|_/g, '');
    // Strip code blocks
    text = text.replace(/```[\s\S]*?```/g, '');
    // Strip inline code
    text = text.replace(/`[^`]+`/g, '');
    // Strip blockquotes
    text = text.replace(/^>\s*/gm, '');

    // Condense all whitespace to single spaces and trim
    text = text.replace(/\s+/g, ' ').trim();

    // Return first chunk of text (up to ~200 chars for reasonable fallback)
    if (text.length === 0) return undefined;
    return text.slice(0, 200);
  }

  /**
   * Format document size for display.
   */
  protected formatDocSize(sizeBytes: number, approxTokens: number): string {
    if (sizeBytes < 1024) {
      return `(${sizeBytes}B, ~${approxTokens} tokens)`;
    } else {
      const kb = (sizeBytes / 1024).toFixed(1);
      return `(${kb}KB, ~${approxTokens} tokens)`;
    }
  }

  /**
   * Truncate text to fit within maxWidth.
   */
  protected truncate(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text;
    return text.slice(0, maxWidth - 3) + '...';
  }

  /**
   * Print description indented, wrapped across lines.
   */
  protected printWrappedDescription(text: string, maxWidth: number, shouldTruncate: boolean): void {
    const indent = '   ';
    const availableWidth = maxWidth - indent.length;

    if (text.length <= availableWidth) {
      console.log(`${indent}${text}`);
      return;
    }

    if (shouldTruncate) {
      // Truncate to two lines max (for fallback body text)
      const firstLine = this.wrapAtWord(text, availableWidth);
      const remainder = text.slice(firstLine.length).trimStart();
      console.log(`${indent}${firstLine}`);
      if (remainder) {
        console.log(`${indent}${this.truncate(remainder, availableWidth)}`);
      }
    } else {
      // Wrap all lines without truncation (for title/description)
      let remaining = text;
      while (remaining.length > 0) {
        if (remaining.length <= availableWidth) {
          console.log(`${indent}${remaining}`);
          break;
        }
        const line = this.wrapAtWord(remaining, availableWidth);
        console.log(`${indent}${line}`);
        remaining = remaining.slice(line.length).trimStart();
      }
    }
  }

  /**
   * Wrap text at word boundary to fit within maxWidth.
   */
  protected wrapAtWord(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text;
    const lastSpace = text.lastIndexOf(' ', maxWidth);
    if (lastSpace > 0) {
      return text.slice(0, lastSpace);
    }
    return text.slice(0, maxWidth);
  }
}
