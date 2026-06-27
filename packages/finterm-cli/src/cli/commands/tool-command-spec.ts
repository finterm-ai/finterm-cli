/**
 * Structured description of the `finterm tool <id>` input surface, extracted from
 * the live Commander tree. The committed JSON artifact is derived from this data so
 * generated docs and drift gates follow the real CLI surface.
 */

import type { Argument, Command, Option } from 'commander';

/** One positional argument of a tool subcommand. */
export interface ToolCommandArgSpec {
  readonly name: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly description: string;
}

/** One option or flag of a tool subcommand. */
export interface ToolCommandOptionSpec {
  /** Commander flag string, for example `--statement-type <type>` or `--no-qa`. */
  readonly flags: string;
  readonly description: string;
  /** The option itself must be supplied, using Commander `mandatory`. */
  readonly required: boolean;
  /** The option takes a value rather than acting as a boolean flag. */
  readonly takesValue: boolean;
  /** A `--no-` prefixed negating boolean flag. */
  readonly negate: boolean;
  /** Allowed values, when the option is choice-constrained. */
  readonly choices?: readonly string[];
  /** Default value, when one is declared. */
  readonly default?: string | number | boolean;
}

/** The full input surface of one `finterm tool <id>` subcommand. */
export interface ToolCommandSpec {
  readonly id: string;
  readonly summary: string;
  readonly args: readonly ToolCommandArgSpec[];
  readonly options: readonly ToolCommandOptionSpec[];
}

function argSpec(argument: Argument): ToolCommandArgSpec {
  return {
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    description: argument.description,
  };
}

function optionSpec(option: Option): ToolCommandOptionSpec {
  const spec: {
    -readonly [K in keyof ToolCommandOptionSpec]: ToolCommandOptionSpec[K];
  } = {
    flags: option.flags,
    description: option.description,
    required: Boolean(option.mandatory),
    takesValue: option.required || option.optional,
    negate: option.negate,
  };
  if (option.argChoices) {
    spec.choices = option.argChoices;
  }
  if (option.defaultValue !== undefined) {
    spec.default = option.defaultValue as string | number | boolean;
  }
  return spec;
}

/**
 * Extract the command spec for every tool subcommand under `finterm tool`, in
 * registration order. Commander's built-in `help` subcommand is skipped.
 */
export function extractToolCommandSpecs(toolCommand: Command): ToolCommandSpec[] {
  return toolCommand.commands
    .filter((subcommand) => subcommand.name() !== 'help')
    .map((subcommand) => ({
      id: subcommand.name(),
      summary: subcommand.description(),
      args: subcommand.registeredArguments.map(argSpec),
      options: subcommand.options.map(optionSpec),
    }));
}
