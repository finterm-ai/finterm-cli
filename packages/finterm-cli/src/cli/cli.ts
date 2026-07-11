/**
 * CLI program setup using Commander.js
 */

import { Command, CommanderError, Option } from 'commander';

import { VERSION } from './lib/version.js';
import { loadDotenvFiles } from './lib/dotenv.js';
import { ensureFintermDirs } from '../cli-io/settings.js';
import {
  OutputManager,
  configureColoredHelp,
  createColoredHelpConfig,
  createHelpEpilog,
  getColorOptionFromArgv,
} from './lib/output.js';
import { shouldColorize } from './lib/context.js';
import { CLIError } from './lib/errors.js';
import { docsCommand } from './commands/docs.js';
import { primeCommand } from './commands/prime.js';
import { skillCommand } from './commands/skill.js';
import { shortcutCommand } from './commands/shortcut.js';
import { resourcesCommand } from './commands/resources.js';
import { initCommand } from './commands/init.js';
import { setupCommand } from './commands/setup.js';
import { authCommand } from './commands/auth.js';
import { createToolCommand } from './commands/tool.js';
import { bundleCommand } from './commands/bundle.js';
import { feedbackCommand } from './commands/feedback.js';
import { runsCommand } from './commands/runs.js';
import { dataroomCommand } from './commands/dataroom.js';
import { getCommandContext } from './lib/context.js';
import { emitActivityStats } from './lib/activity-stats.js';

/**
 * Detect `--json` directly from argv, before Commander parses options, so early
 * error output can pick the right format.
 */
function isJsonMode(): boolean {
  return process.argv.includes('--json');
}

/**
 * Detect `--experimental` from argv at program-build time, so preview command
 * groups can be registered (or hidden) before parsing.
 */
function isExperimentalMode(): boolean {
  return process.argv.includes('--experimental');
}

/**
 * Output error in the appropriate format (JSON or text).
 *
 * One error format CLI-wide (O6): the OutputManager '✗ message' style with
 * semantic colors in text mode, and the {error, type?, code?, details?}
 * envelope on stderr in --json mode — Commander parse errors included.
 */
function outputError(message: string, error?: Error): void {
  if (isJsonMode()) {
    const errorObj: { error: string; type?: string; code?: string; details?: string } = {
      error: message,
    };
    if (error instanceof CLIError) {
      errorObj.type = error.name;
      if (error.code !== undefined) {
        errorObj.code = error.code;
      }
    }
    if (error && error.message !== message) {
      errorObj.details = error.message;
    }
    console.error(JSON.stringify(errorObj));
  } else {
    // Pre-parse context: only argv-derived settings are safe to read here.
    const output = new OutputManager({
      dryRun: false,
      verbose: false,
      quiet: false,
      json: false,
      color: getColorOptionFromArgv(),
      nonInteractive: true,
      debug: false,
      experimental: false,
    });
    output.error(message, error && error.message !== message ? error : undefined);
  }
}

/**
 * Commander writes usage-error text via writeErr BEFORE throwing under
 * exitOverride; buffering it lets runCli restyle those errors through the
 * one CLI error format (text '✗ …' / JSON envelope) instead of Commander's
 * own 'error: …' lines.
 */
let commanderErrBuffer = '';

/**
 * Apply colored help + the shared output/error configuration to the program and
 * all commands recursively. addCommand() does NOT inherit exitOverride or
 * configureOutput from the root, so each command needs them applied directly —
 * otherwise subcommand usage errors bypass the exit-2/JSON error contract.
 */
function applyColoredHelpToAllCommands(program: Command): void {
  const colorOption = getColorOptionFromArgv();
  const helpConfig = createColoredHelpConfig(colorOption);
  const epilog = createHelpEpilog(colorOption);

  // Add epilog to main program only
  program.addHelpText('afterAll', `\n${epilog}`);

  const applyRecursively = (cmd: Command) => {
    cmd.configureHelp(helpConfig);
    cmd.exitOverride();
    cmd.showHelpAfterError('(add --help for additional information)');
    cmd.configureOutput({
      writeErr: (str: string) => {
        commanderErrBuffer += str;
      },
      getOutHasColors: () => shouldColorize(colorOption),
      getErrHasColors: () => shouldColorize(colorOption),
    });
    for (const sub of cmd.commands) {
      applyRecursively(sub);
    }
  };

  applyRecursively(program);
}

/**
 * Create and configure the CLI program.
 *
 * Exported for tests; production entry points go through {@link runCli}.
 */
export function createProgram(): Command {
  const program = new Command()
    .name('finterm')
    .description(
      'The Finterm CLI.\n\nRun `finterm docs` for documentation or visit https://finterm.ai to get started.'
    )
    .version(VERSION, '--version', 'Show version number')
    .helpOption('--help', 'Display help for command')
    .showHelpAfterError('(add --help for additional information)');

  configureColoredHelp(program);

  program
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--verbose', 'Enable verbose output')
    .option('--quiet', 'Suppress non-essential output')
    .option('--json', 'Output as JSON')
    .addOption(
      new Option('--color <when>', 'Colorize output')
        .choices(['auto', 'always', 'never'])
        .default('auto')
    )
    .option('--non-interactive', 'Disable all prompts, fail if input required')
    .option('--debug', 'Show debug information')
    .option('--experimental', 'Enable preview command groups and tools');

  // Add commands in logical groups
  program.commandsGroup('Agent Guidance:');
  program.addCommand(docsCommand);
  program.addCommand(primeCommand);
  program.addCommand(skillCommand);
  program.addCommand(shortcutCommand);
  program.addCommand(resourcesCommand);

  program.commandsGroup('Setup & Configuration:');
  program.addCommand(initCommand);
  program.addCommand(setupCommand);

  program.commandsGroup('Authentication:');
  program.addCommand(authCommand);

  program.commandsGroup('Company Research:');
  program.addCommand(bundleCommand);
  program.addCommand(runsCommand);
  program.addCommand(dataroomCommand);

  program.commandsGroup('Point Data Tools:');
  program.addCommand(createToolCommand({ experimental: isExperimentalMode() }));

  program.commandsGroup('Feedback and Support:');
  program.addCommand(feedbackCommand);

  applyColoredHelpToAllCommands(program);

  return program;
}

/**
 * Emit end-of-run activity stats without ever failing the command: stats are a
 * diagnostic nicety, so errors are swallowed unless `--debug` asks to see them.
 */
async function safeEmitActivityStats(program: Command): Promise<void> {
  try {
    await emitActivityStats(getCommandContext(program));
  } catch (error) {
    if (!process.argv.includes('--debug')) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[debug] Failed to emit activity stats: ${message}`);
  }
}

/**
 * Run the CLI. This is the main entry point.
 */
export async function runCli(): Promise<void> {
  // Load .env files, walking up from CWD to find them (supports monorepo layouts).
  // Priority: .env.local overrides .env; closer files override farther ones.
  loadDotenvFiles();

  // Ensure ~/.finterm/ directory structure exists on first run
  await ensureFintermDirs();

  const program = createProgram();

  // exitOverride + buffered writeErr are applied to every command inside
  // createProgram (applyColoredHelpToAllCommands): usage errors are
  // ValidationError-class (exit 2) and JSON-aware like every other error (O5).

  try {
    await program.parseAsync(process.argv);
    await safeEmitActivityStats(program);
  } catch (error) {
    await safeEmitActivityStats(program);
    if (error instanceof CommanderError) {
      // Successful terminal states: --help / --version display.
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        process.exit(0);
      }
      // Restyle Commander's buffered stderr: first line is `error: <message>`,
      // any following lines (the showHelpAfterError hint) pass through.
      const lines = commanderErrBuffer.trimEnd().split('\n');
      const bufferedFirst = (lines[0] ?? '').replace(/^error: /, '');
      const message = bufferedFirst.trim() === '' ? error.message : bufferedFirst;
      outputError(message);
      if (!isJsonMode()) {
        for (const line of lines.slice(1)) {
          console.error(line);
        }
      }
      // Usage/validation failures exit 2 per the error contract.
      process.exit(2);
    }
    if (error instanceof CLIError) {
      outputError(error.message, error);
      process.exit(error.exitCode);
    }
    // Unexpected error
    const message = error instanceof Error ? error.message : String(error);
    outputError(message, error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.error('\nInterrupted');
  process.exit(130); // 128 + SIGINT(2)
});
