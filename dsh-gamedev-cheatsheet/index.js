/**
 * dsh-gamedev-cheatsheet
 *
 * A DSH bundle that delivers the `gamedev-cheatsheet` Agent Skill.
 *
 * DSH loads Agent Skills from `<DSH_AGENTS_HOME or ~/.agents>/skills/<name>`.
 * This plugin ships the skill inside the package and installs it there on
 * activation, so `dsh plugin add dsh-gamedev-cheatsheet` is all a user needs:
 * the skill becomes available to the agent on the next session.
 *
 * Delivery is idempotent and version-stamped: re-activating on the same
 * version does nothing, a version bump replaces the installed copy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'gamedev-cheatsheet';
const VERSION = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version;

/** Directory DSH reads Agent Skills from. */
function skillsRoot() {
  const agentsHome = process.env.DSH_AGENTS_HOME || join(homedir(), '.agents');
  return join(agentsHome, 'skills');
}

export function apply(ctx, config = {}) {
  const log = ctx?.logger?.('gamedev-cheatsheet') ?? console;
  const enabled = config?.installSkill !== false;

  if (!enabled) {
    log.info?.('skill installation disabled by config; package registered only');
    return;
  }

  try {
    const dest = join(skillsRoot(), SKILL_NAME);
    const stamp = join(dest, '.installed-version');

    if (existsSync(stamp)) {
      const installed = readFileSync(stamp, 'utf8').trim();
      if (installed === VERSION) return; // already current, nothing to do
    }

    // Replace the previous copy so a version bump cannot leave stale files.
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(HERE, 'skill'), dest, { recursive: true });
    writeFileSync(stamp, `${VERSION}\n`);

    log.info?.(`installed skill "${SKILL_NAME}" v${VERSION} → ${dest}`);
  } catch (error) {
    // Never fail activation over a delivery problem: the host stays usable and
    // the user can install the skill manually from the package's skill/ folder.
    log.warn?.(`could not install skill "${SKILL_NAME}": ${error?.message ?? error}`);
  }
}
