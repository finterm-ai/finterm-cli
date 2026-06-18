/**
 * `finterm setup` - Install the Finterm agent skill for your coding agents.
 *
 * One command, idempotent and non-interactive. It writes the skill to the vendor-neutral
 * `.agents/skills/finterm/SKILL.md` (read natively by Codex and Gemini CLI; reached by
 * Cursor/Copilot/… via skills.sh) and, when Claude Code is present, an identical copy to
 * `.claude/skills/finterm/SKILL.md` plus the `finterm prime` session hooks. Re-running
 * reports "already set up".
 *
 *   finterm setup            install or refresh (idempotent)
 *   finterm setup --check    read-only status
 *   finterm setup --remove   uninstall
 *
 * Why copy (not symlink): per tbd guideline `cli-agent-skill-patterns` §6.6, a copied
 * mirror behaves predictably across Windows, sandboxes, and remote worktrees, where
 * symlinks do not. Symlinking is a single-machine optimization (`npx skills`, `qmd`);
 * an end-user CLI install copies. `.agents/skills/finterm/SKILL.md` is the source of
 * truth and both copies carry identical content (rewritten every run, so no drift).
 */

import { Command } from 'commander';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';

import { BaseCommand } from '../lib/base-command.js';
import { CLIError, isExpectedFsError } from '../lib/errors.js';
import { pathExists, writeFile } from '../lib/fs.js';
import { loadSkillContent } from './prime.js';

interface SetupOptions {
  check: boolean;
  remove: boolean;
}

/** Claude Code session hooks that re-prime finterm context. */
const CLAUDE_GLOBAL_HOOKS = {
  SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'finterm prime' }] }],
  PreCompact: [{ matcher: '', hooks: [{ type: 'command', command: 'finterm prime' }] }],
};

/** Canonical, vendor-neutral skill: `<cwd>/.agents/skills/finterm/SKILL.md`. */
function agentsSkillFile(): string {
  return join(process.cwd(), '.agents', 'skills', 'finterm', 'SKILL.md');
}
/** Claude Code mirror (Claude reads only `.claude/skills/`): identical copy. */
function claudeSkillFile(): string {
  return join(process.cwd(), '.claude', 'skills', 'finterm', 'SKILL.md');
}
function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

/** Claude Code is "present" if its home dir exists or a CLAUDE_* env var is set. */
async function detectClaude(): Promise<boolean> {
  const hasClaudeDir = await pathExists(join(homedir(), '.claude'));
  const hasClaudeEnv = Object.keys(process.env).some((k) => k.startsWith('CLAUDE_'));
  return hasClaudeDir || hasClaudeEnv;
}

/** Are the finterm session hooks present in Claude's global settings? */
async function claudeHooksInstalled(): Promise<boolean> {
  try {
    const settings = JSON.parse(await readFile(claudeSettingsPath(), 'utf-8')) as {
      hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
    };
    const has = (key: string) =>
      settings.hooks?.[key]?.some((h) =>
        h.hooks?.some((x) => x.command?.includes('finterm prime'))
      );
    return Boolean(has('SessionStart') && has('PreCompact'));
  } catch {
    return false;
  }
}

class SetupHandler extends BaseCommand {
  async run(options: SetupOptions): Promise<void> {
    if (options.check) return this.runCheck();
    if (options.remove) return this.runRemove();
    return this.runInstall();
  }

  /** Write SKILL.md to a skill path, creating the dir. */
  private async writeSkill(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, loadSkillContent());
  }

  /** Install or refresh; report what changed, or "already set up" when nothing did. */
  private async runInstall(): Promise<void> {
    const colors = this.output.getColors();
    const claude = await detectClaude();

    // Snapshot prior state so we can say "already set up" vs "installed".
    const agentsExisted = await pathExists(agentsSkillFile());
    const claudeExisted = claude && (await pathExists(claudeSkillFile()));
    const hooksExisted = claude && (await claudeHooksInstalled());
    const alreadySetUp = agentsExisted && (!claude || (claudeExisted && hooksExisted));

    if (
      this.checkDryRun(
        'Would install the finterm skill into .agents/skills (+ .claude mirror and hooks when Claude is present)'
      )
    ) {
      return;
    }

    // Canonical skill (always), refreshed every run so the two copies never drift.
    await this.writeSkill(agentsSkillFile());

    // Claude mirror + session hooks, only when Claude Code is present.
    if (claude) {
      await this.writeSkill(claudeSkillFile());
      await this.ensureClaudeHooks();
    }

    if (this.ctx.json) {
      this.output.data({
        skill: agentsSkillFile(),
        claudeMirror: claude ? claudeSkillFile() : null,
        claudeDetected: claude,
        alreadySetUp,
      });
      return;
    }

    console.log('');
    if (alreadySetUp) {
      this.output.success('Already set up.');
      console.log(colors.dim(`  Skill: ${rel(agentsSkillFile())}`));
      if (claude) console.log(colors.dim(`  Claude: ${rel(claudeSkillFile())} + session hooks`));
      return;
    }

    console.log(colors.bold('Finterm skill installed'));
    console.log(`  ${colors.success('✓')} ${rel(agentsSkillFile())}`);
    console.log(
      colors.dim('     read by Codex & Gemini CLI natively; Cursor/Copilot/… via skills.sh')
    );
    if (claude) {
      console.log(
        `  ${colors.success('✓')} Claude Code: ${rel(claudeSkillFile())} + session hooks`
      );
    } else {
      console.log('');
      console.log(colors.dim('  No Claude Code detected — its mirror + hooks were skipped.'));
    }
    console.log('');
    console.log(colors.dim('Check status anytime: finterm setup --check'));
  }

  /** Read-only status. */
  private async runCheck(): Promise<void> {
    const colors = this.output.getColors();
    const claude = await detectClaude();
    const status = {
      skill: await pathExists(agentsSkillFile()),
      claudeDetected: claude,
      claudeMirror: claude ? await pathExists(claudeSkillFile()) : false,
      claudeHooks: claude ? await claudeHooksInstalled() : false,
    };

    if (this.ctx.json) {
      this.output.data(status);
      return;
    }

    const mark = (ok: boolean) => (ok ? colors.success('✓') : colors.warn('⚠'));
    console.log(colors.bold('Finterm Setup Status'));
    console.log('');
    console.log(`  ${mark(status.skill)} Skill: ${rel(agentsSkillFile())}`);
    if (claude) {
      console.log(`  ${mark(status.claudeMirror)} Claude mirror: ${rel(claudeSkillFile())}`);
      console.log(`  ${mark(status.claudeHooks)} Claude session hooks`);
    } else {
      console.log(
        `  ${colors.dim('-')} Claude Code not detected (skill is read natively by other agents)`
      );
    }

    const ready = status.skill && (!claude || (status.claudeMirror && status.claudeHooks));
    if (!ready) {
      console.log('');
      console.log(colors.dim('Run: finterm setup'));
    }
  }

  /** Uninstall: both skill copies and the Claude hooks. */
  private async runRemove(): Promise<void> {
    if (this.checkDryRun('Would remove the finterm skill (.agents + .claude) and Claude hooks')) {
      return;
    }

    let removed = false;
    for (const file of [agentsSkillFile(), claudeSkillFile()]) {
      try {
        await rm(dirname(file), { recursive: true, force: true });
        removed = true;
      } catch (error) {
        if (!isExpectedFsError(error)) throw error;
      }
    }
    await this.removeClaudeHooks();

    if (removed) this.output.success('Removed the finterm skill and Claude integration.');
    else this.output.notice('Nothing to remove.');
  }

  /** Merge the finterm session hooks into Claude's global settings.json. */
  private async ensureClaudeHooks(): Promise<void> {
    const path = claudeSettingsPath();
    try {
      await mkdir(dirname(path), { recursive: true });
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
      } catch (error) {
        if (!isExpectedFsError(error)) throw error;
      }
      const existing = settings.hooks;
      settings.hooks = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        ...CLAUDE_GLOBAL_HOOKS,
      };
      await writeFile(path, JSON.stringify(settings, null, 2) + '\n');
    } catch (error) {
      throw new CLIError(`Failed to install Claude hooks: ${(error as Error).message}`);
    }
  }

  /** Strip the finterm session hooks back out of Claude's global settings.json. */
  private async removeClaudeHooks(): Promise<void> {
    const path = claudeSettingsPath();
    try {
      const settings = JSON.parse(await readFile(path, 'utf-8')) as {
        hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
      };
      if (!settings.hooks) return;
      for (const key of ['SessionStart', 'PreCompact']) {
        const kept = settings.hooks[key]?.filter(
          (h) => !h.hooks?.some((x) => x.command?.includes('finterm prime'))
        );
        if (kept && kept.length > 0) settings.hooks[key] = kept;
        else delete settings.hooks[key];
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      await writeFile(path, JSON.stringify(settings, null, 2) + '\n');
    } catch (error) {
      if (!isExpectedFsError(error)) throw error;
    }
  }
}

/** Path relative to cwd for tidy display (e.g. `.agents/skills/finterm/SKILL.md`). */
function rel(p: string): string {
  const r = relative(process.cwd(), p);
  return r.startsWith('..') ? p : r;
}

export const setupCommand = new Command('setup')
  .description('Install the Finterm agent skill for your coding agents')
  .option('--check', 'Show setup status without changing anything', false)
  .option('--remove', 'Remove the finterm skill and Claude integration', false)
  .action(async (options, command) => {
    const handler = new SetupHandler(command);
    await handler.run(options);
  });
