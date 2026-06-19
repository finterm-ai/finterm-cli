/**
 * Tests for `finterm setup`'s Claude Code hook installation.
 *
 * The setup command merges finterm's session hooks (`finterm prime` on
 * SessionStart / PreCompact) into the user's global Claude settings.json.
 * These tests pin the contract that installing the hooks NEVER clobbers a
 * user's own hook entries and is idempotent across repeated runs.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { setupCommand } from './setup.js';

/**
 * Shape of the relevant slice of Claude's settings.json: `hooks` maps an event
 * name (SessionStart, PreCompact, ...) to an array of hook groups, each of
 * which carries a matcher and a list of `{ type, command }` entries.
 */
interface HookEntry {
  command?: string;
  type?: string;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}
interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

/** A user-authored hook that has nothing to do with finterm. */
function userHookGroup(command: string): HookGroup {
  return { matcher: '', hooks: [{ type: 'command', command }] };
}

/** Count hook groups in `event` whose commands mention `finterm prime`. */
function countFintermGroups(settings: ClaudeSettings, event: string): number {
  const groups = settings.hooks?.[event] ?? [];
  return groups.filter((g) => g.hooks?.some((h) => h.command?.includes('finterm prime'))).length;
}

/** All commands present under `event`, flattened across groups. */
function commandsFor(settings: ClaudeSettings, event: string): string[] {
  const groups = settings.hooks?.[event] ?? [];
  return groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? ''));
}

describe('finterm setup: Claude hook merge', () => {
  let workdir: string; // becomes process.cwd() so skill files land in temp
  let fakeHome: string; // becomes HOME so settings.json is isolated
  let settingsPath: string;

  const origCwd = process.cwd();
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origClaudeEnv = process.env.CLAUDE_TEST_MARKER;

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'finterm-setup-'));
    workdir = join(base, 'work');
    fakeHome = join(base, 'home');

    // The install routine loads SKILL.md via a `<cwd>/src/docs/SKILL.md`
    // fallback; provide one so the skill write succeeds in isolation.
    await mkdir(join(workdir, 'src', 'docs'), { recursive: true });
    await writeFile(join(workdir, 'src', 'docs', 'SKILL.md'), '# Finterm skill\n');

    // Isolated home: settings.json lives under `<home>/.claude/`.
    const claudeDir = join(fakeHome, '.claude');
    await mkdir(claudeDir, { recursive: true });
    settingsPath = join(claudeDir, 'settings.json');

    process.chdir(workdir);
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome; // Windows-equivalent of HOME
    // Ensure Claude Code is "detected" so the hook merge actually runs.
    process.env.CLAUDE_TEST_MARKER = '1';
  });

  afterEach(async () => {
    process.chdir(origCwd);
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    if (origClaudeEnv === undefined) delete process.env.CLAUDE_TEST_MARKER;
    else process.env.CLAUDE_TEST_MARKER = origClaudeEnv;
    // Best-effort cleanup of the temp tree (workdir's parent).
    await rm(join(workdir, '..'), { recursive: true, force: true }).catch(() => {});
  });

  async function readSettings(): Promise<ClaudeSettings> {
    return JSON.parse(await readFile(settingsPath, 'utf-8')) as ClaudeSettings;
  }

  async function runInstall(): Promise<void> {
    // Drive the public command. A fresh argv vector keeps Commander's parsed
    // option state clean between invocations.
    await setupCommand.parseAsync(['node', 'setup']);
  }

  it("preserves a user's existing SessionStart and PreCompact hooks while appending finterm's", async () => {
    const userSession = userHookGroup('echo my-session-hook');
    const userPreCompact = userHookGroup('echo my-precompact-hook');
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [userSession],
            PreCompact: [userPreCompact],
          },
        },
        null,
        2
      )
    );

    await runInstall();

    const after = await readSettings();

    // The user's own hooks must still be present, untouched.
    expect(commandsFor(after, 'SessionStart')).toContain('echo my-session-hook');
    expect(commandsFor(after, 'PreCompact')).toContain('echo my-precompact-hook');

    // finterm's hook must be appended (not replacing the user's array).
    expect(commandsFor(after, 'SessionStart')).toContain('finterm prime');
    expect(commandsFor(after, 'PreCompact')).toContain('finterm prime');

    // Exactly one finterm group per event, and the user's group is retained,
    // so each event has at least two groups.
    expect(countFintermGroups(after, 'SessionStart')).toBe(1);
    expect(countFintermGroups(after, 'PreCompact')).toBe(1);
    expect(after.hooks?.SessionStart?.length).toBeGreaterThanOrEqual(2);
    expect(after.hooks?.PreCompact?.length).toBeGreaterThanOrEqual(2);
  });

  it('does not duplicate finterm hooks when install runs twice (idempotent)', async () => {
    // Start with a user hook only on SessionStart; PreCompact starts empty.
    await writeFile(
      settingsPath,
      JSON.stringify({ hooks: { SessionStart: [userHookGroup('echo my-session-hook')] } }, null, 2)
    );

    await runInstall();
    await runInstall();

    const after = await readSettings();

    // Re-running must not append a second finterm group to either event.
    expect(countFintermGroups(after, 'SessionStart')).toBe(1);
    expect(countFintermGroups(after, 'PreCompact')).toBe(1);

    // The user's pre-existing hook survives both runs.
    expect(commandsFor(after, 'SessionStart')).toContain('echo my-session-hook');
  });

  it('installs finterm hooks into an empty settings object without a hooks key', async () => {
    await writeFile(settingsPath, JSON.stringify({ someUnrelated: true }, null, 2));

    await runInstall();

    const after = await readSettings();

    // Unrelated top-level settings are preserved.
    expect(after.someUnrelated).toBe(true);
    expect(countFintermGroups(after, 'SessionStart')).toBe(1);
    expect(countFintermGroups(after, 'PreCompact')).toBe(1);
  });
});
