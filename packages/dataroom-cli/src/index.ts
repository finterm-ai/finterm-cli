/**
 * Database-free DR/0.3 profile:file Dataroom command tree shared by the finterm CLI.
 *
 * This package keeps the CLI surface separate from the `dataroom` core package so the
 * read and search commands can be reused without pulling in the core implementation.
 */

import { Command, InvalidArgumentError } from 'commander';
import {
  DEFAULTS,
  listFileProfileFiles,
  matchesFacetFilters,
  openFileProfileRoom,
  readFileProfileArtifact,
  searchFileProfileFiles,
  type FacetFilter,
  type FacetValue,
  type FileProfileFile,
} from 'dataroom';

interface CommandOptions {
  json?: boolean;
}

interface FilesOptions extends CommandOptions {
  pathPrefix?: string;
  limit?: string;
  facet?: FacetFilter[];
}

interface ReadOptions extends CommandOptions {
  maxBytes?: string;
}

interface SearchOptions extends CommandOptions {
  pathPrefix?: string;
  limit?: string;
  facet?: FacetFilter[];
}

type InfoOptions = CommandOptions;

const DEFAULT_READ_MAX_BYTES = DEFAULTS.AGENT_READ_MAX_BYTES;
const DEFAULT_SEARCH_LIMIT = 20;

export function buildDataroomCommand(): Command {
  const command = new Command('dataroom').description(
    'Read and search a downloaded local Dataroom (DR/0.3 profile:file room)'
  );

  command.option('--json', 'Output as JSON');

  command
    .command('files <room>')
    .description('List file artifacts in a DR/0.3 profile:file room')
    .option('--path-prefix <prefix>', 'Only include files under this path prefix')
    .option(
      '--facet <key=value>',
      'Only include files matching a file metadata facet',
      collectFacet,
      []
    )
    .option('--limit <n>', 'Maximum number of files to return')
    .option('--json', 'Output as JSON')
    .action(filesAction);

  command
    .command('search <room> <query>')
    .description('Search text file artifacts in a DR/0.3 profile:file room')
    .option('--path-prefix <prefix>', 'Only search files under this path prefix')
    .option(
      '--facet <key=value>',
      'Only search files matching a file metadata facet',
      collectFacet,
      []
    )
    .option('--limit <n>', 'Maximum number of matches to return')
    .option('--json', 'Output as JSON')
    .action(searchAction);

  command
    .command('read <room> <ref>')
    .description('Read a file artifact from a DR/0.3 profile:file room')
    .option('--max-bytes <n>', 'Maximum bytes to return')
    .option('--json', 'Output as JSON')
    .action(readAction);

  command
    .command('list <room>')
    .description('List file artifacts in a DR/0.3 profile:file room')
    .option('--path-prefix <prefix>', 'Only include files under this path prefix')
    .option(
      '--facet <key=value>',
      'Only include files matching a file metadata facet',
      collectFacet,
      []
    )
    .option('--limit <n>', 'Maximum number of files to return')
    .option('--json', 'Output as JSON')
    .action(filesAction);

  command
    .command('info <room>')
    .description('Show DR/0.3 profile:file room information')
    .option('--json', 'Output as JSON')
    .action(infoAction);

  return command;
}

async function filesAction(
  roomPath: string,
  options: FilesOptions,
  command: Command
): Promise<void> {
  const room = await openFileProfileRoom(roomPath);
  const limit = parsePositiveInteger('--limit', options.limit, Number.POSITIVE_INFINITY);
  const prefix = normalizePathPrefix(options.pathPrefix);
  const files = listFileProfileFiles(room)
    .filter((file) => !prefix || file.path.startsWith(prefix))
    .filter((file) => matchesFacetFilters(file.facets, options.facet ?? []))
    .slice(0, limit)
    .map(projectFile);

  if (shouldOutputJson(command, options)) {
    outputJson({ ok: true, files });
    return;
  }
  for (const file of files) {
    console.log(`${room.metadata.name} ${file.ref} ${file.contentType}`);
  }
}

async function readAction(
  roomPath: string,
  ref: string,
  options: ReadOptions,
  command: Command
): Promise<void> {
  const room = await openFileProfileRoom(roomPath);
  const maxBytes = parseNonNegativeInteger('--max-bytes', options.maxBytes, DEFAULT_READ_MAX_BYTES);
  const result = await readFileProfileArtifact(room, ref, { maxBytes });

  if (shouldOutputJson(command, options)) {
    outputJson({
      ok: result.text !== undefined,
      ref: result.ref,
      contentType: result.contentType,
      facets: result.facets,
      size: result.size,
      bytesReturned: result.bytesReturned,
      truncated: result.truncated,
      ...(result.text === undefined ? { missReason: 'binary_content' } : {}),
      ...(result.truncated ? { missReason: 'read_limit_exceeded' } : {}),
      ...(result.text !== undefined ? { text: result.text } : {}),
    });
    return;
  }

  if (result.text === undefined) {
    console.log(`Binary content: ${result.contentType}`);
    console.log(`Size: ${result.size} bytes`);
    return;
  }
  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

async function searchAction(
  roomPath: string,
  query: string,
  options: SearchOptions,
  command: Command
): Promise<void> {
  const room = await openFileProfileRoom(roomPath);
  const limit = parsePositiveInteger('--limit', options.limit, DEFAULT_SEARCH_LIMIT);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const matches = await searchFileProfileFiles(room, query, {
    limit,
    facets: options.facet ?? [],
    ...(pathPrefix ? { pathPrefix } : {}),
  });

  if (shouldOutputJson(command, options)) {
    outputJson({ ok: matches.length > 0, query: { text: query }, matches });
    return;
  }
  for (const match of matches) {
    console.log(`${match.roomId} ${match.ref}:${match.line}`);
    console.log(`  ${match.snippet}`);
  }
}

async function infoAction(roomPath: string, options: InfoOptions, command: Command): Promise<void> {
  const room = await openFileProfileRoom(roomPath);
  const files = listFileProfileFiles(room);
  const fileSize = files.reduce((sum, file) => sum + file.size, 0);
  if (shouldOutputJson(command, options)) {
    outputJson({
      type: 'room',
      name: room.metadata.name,
      title: room.metadata.title,
      path: room.path,
      format: room.metadata.format,
      profile: room.metadata.profile,
      capabilities: room.metadata.capabilities,
      stats: {
        fileCount: files.length,
        fileSize,
      },
    });
    return;
  }
  console.log(`Dataroom: ${room.metadata.name}`);
  console.log(`  Path: ${room.path}`);
  console.log(`  Format: ${room.metadata.format}`);
  console.log(`  Profile: ${room.metadata.profile}`);
  console.log(`  Files: ${files.length} (${fileSize} bytes)`);
}

function shouldOutputJson(command: Command, options: CommandOptions): boolean {
  if (options.json === true) {
    return true;
  }
  let current: Command | null = command;
  while (current) {
    const opts = current.opts<CommandOptions>();
    if (opts.json === true) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
}

function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function parsePositiveInteger(
  optionName: string,
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(
  optionName: string,
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`${optionName} must be a non-negative integer`);
  }
  return parsed;
}

function normalizePathPrefix(prefix: string | undefined): string | undefined {
  return prefix?.replace(/^files\//, '').replace(/^file:/, '');
}

function collectFacet(value: string, previous: FacetFilter[]): FacetFilter[] {
  return [...previous, parseFacet(value)];
}

function parseFacet(value: string): FacetFilter {
  const equalsIndex = value.indexOf('=');
  if (equalsIndex <= 0) {
    throw new InvalidArgumentError('--facet must use key=value');
  }
  return {
    key: value.slice(0, equalsIndex) as FacetFilter['key'],
    value: parseFacetValue(value.slice(equalsIndex + 1)),
  };
}

function parseFacetValue(value: string): FacetValue {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value === 'null') {
    return null;
  }
  const numeric = Number(value);
  if (value.trim() !== '' && Number.isFinite(numeric)) {
    return numeric;
  }
  return value;
}

function projectFile(file: FileProfileFile): Omit<FileProfileFile, 'absolutePath'> {
  return {
    roomId: file.roomId,
    ref: file.ref,
    path: file.path,
    contentType: file.contentType,
    size: file.size,
    updatedAt: file.updatedAt,
    entry: file.entry,
    facets: file.facets,
    ...(file.metadata ? { metadata: file.metadata } : {}),
  };
}
