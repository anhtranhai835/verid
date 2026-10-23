import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ROLES,
  DRIVES,
  manifestUpgrade,
  MODES,
  ROLE_NAMES,
  parseManifest,
  renderManifest,
  suggestManifest,
  suggestMode,
  type InitFlags,
  type Repo,
  type ProjectFacts,
  type Roles,
} from "../core/manifest.js";
import { goneRunners, runnerKey, runnerLabel, type Runner } from "../core/runners.js";
import { hasVeridHooks, withVeridHooks } from "../adapters/claude-settings.js";
import { bilingual, t, type Lang } from "../adapters/i18n.js";
import {
  isDirectory,
  loadManifest,
  manifestFile,
  upgradeManifestText,
} from "../adapters/manifest.js";
import { findRunners } from "../adapters/test-runner.js";
import {
  errno,
  languageOf,
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";

import type { CliResult } from "./test.js";

const LANGS = ["vi", "en"] as const;

export type Action = "created" | "kept" | "updated";

/** What `verid cook` will do, checked and not yet written: `apply` writes it. */
export interface CookPlan {
  steps: { action: Action; rel: string }[];
  notes: string[];
  /** The repo of the manifest it will create, when it creates one. */
  repo?: Repo;
  apply: () => void;
}

const invalid = (path: string, detail: string) =>
  new VeridError("VERID_BURNT_INIT_INVALID", { path, detail });

/**
 * `verid cook`: set verid up for the project (committed: the manifest and .verid/.gitignore) and
 * for this machine (state, and hooks in .claude/settings.local.json pointing at this verid).
 * Everything is checked before anything is written, and nothing that exists is overwritten
 * except verid's own hook entries. Safe to run again, and by each teammate after cloning.
 */
export async function initCommand(project: string, flags: InitFlags): Promise<CliResult> {
  const plan = await planCook(project, flags);
  plan.apply();
  const report = plan.steps.map((s) => `  ${s.action.padEnd(9)}${s.rel}`);
  // The same ending as the screen in a terminal: what to commit, then what to do next.
  const out = [
    `verid cook (${project})`,
    ...report,
    ...plan.notes,
    bilingual("init.done", {}),
    await servedLine(project),
  ];
  return { exit: 0, stdout: `${out.join("\n")}\n`, stderr: "" };
}

/** cook's last line: the next step, which in remix is the baseline, until there is one. */
export async function servedLine(project: string): Promise<string> {
  const remix = (await loadManifest(project))?.mode === "remix";
  const first = remix && readState(statePaths(project)).baseline === null;
  return `🍽️  ${bilingual(first ? "cook.served_remix" : "cook.served", {})}`;
}

/** Checks everything `verid cook` needs and returns what it would write, writing nothing. */
export async function planCook(project: string, flags: InitFlags): Promise<CookPlan> {
  // Claude Code sets CLAUDECODE in every session: an agent that deleted .verid must
  // not be able to rebuild it with fresh counters, no audit trail and maybe no manifest.
  if (process.env.CLAUDECODE === "1") throw new VeridError("VERID_BURNT_INIT_IN_AGENT");

  const paths = statePaths(project);
  const steps: CookPlan["steps"] = [];
  const writes: Array<() => void> = [];
  const notes: string[] = [];
  const step = (action: Action, rel: string, write?: () => void) => {
    steps.push({ action, rel });
    if (write) writes.push(write);
  };

  // Settings first: if they cannot be used, nothing else has been touched.
  const settingsFile = join(project, ".claude", "settings.local.json");
  const settingsText = readText(settingsFile);
  const hook = fileURLToPath(new URL("./hook.js", import.meta.url));
  let merged: ReturnType<typeof withVeridHooks>;
  try {
    merged = withVeridHooks(settingsText === null ? {} : JSON.parse(settingsText), hook);
  } catch (e) {
    throw invalid(settingsFile, e instanceof Error ? e.message : String(e));
  }

  // The language for this machine's messages, kept in its state.
  const language = flags.lang === undefined ? undefined : LANGS.find((l) => l === flags.lang);
  if (flags.lang !== undefined && !language) throw invalid("--lang", "must be vi or en");
  const existing = await loadManifest(project);
  // The runners verid sees now, when the manifest leaves the test command to verid.
  const sees = (repo: Repo) =>
    repo.test_cmd === undefined
      ? findRunners(resolve(project, repo.path), {
          sourceGlobs: repo.source_globs,
          testGlobs: repo.test_globs,
          ignoreGlobs: repo.ignore_globs ?? [],
        })
      : null;
  if (existsSync(paths.file)) {
    const state = readState(paths); // a broken state stops cook: the developer must look at it
    // The developer running cook again is how a runner whose build file is gone is dropped.
    const now = existing?.repos[0] && sees(existing.repos[0]);
    const gone = now ? goneRunners(state.runners, now.runners.map(runnerKey)) : [];
    if (gone.length > 0)
      notes.push(
        bilingual("init.runners_forgotten", { runners: gone.map(runnerLabel).join(", ") }),
      );
    if ((language && state.language !== language) || gone.length > 0)
      step("updated", ".verid/.state/state.json", () =>
        withLock(paths, () => {
          const s = readState(paths);
          writeState(paths, {
            ...s,
            ...(language && { language }),
            runners: s.runners.filter((k) => !gone.includes(k)),
          });
        }),
      );
    else step("kept", ".verid/.state/state.json");
  } else {
    // Every other field has a default (core/state.ts).
    const fresh = { schemaVersion: 1, ...(language && { language }) };
    step("created", ".verid/.state/state.json", () =>
      writeFileSync(paths.file, `${JSON.stringify(fresh)}\n`, { flag: "wx" }),
    );
  }

  const gitignore = join(project, ".verid", ".gitignore");
  if (existsSync(gitignore)) step("kept", ".verid/.gitignore");
  // `wx`: a file that appeared since the check is the developer's, never overwritten.
  else
    step("created", ".verid/.gitignore", () =>
      writeFileSync(gitignore, ".state/\n", { flag: "wx" }),
    );

  let repo: Repo | undefined;
  // The roles the manifest maps once cook is done: verid's own unless the developer chose others.
  let roles: Roles | null | undefined;
  const flagsGiven =
    flags.mode !== undefined ||
    flags.drive !== undefined ||
    flags.testCmd !== undefined ||
    flags.src.length > 0 ||
    flags.tests.length > 0;
  if (existing) {
    const upgrade = existing.repos[0] ? manifestUpgrade(existing.repos[0], existing.roles) : null;
    roles = existing.roles ?? (flags.upgrade ? upgrade?.roles : null);
    const items = upgrade ? upgradeLines(upgrade) : [];
    if (upgrade && items.length > 0 && flags.upgrade) {
      // Edited on what is there now, checked before anything is written.
      const text = await upgradeManifestText(readText(manifestFile(project)) ?? "", upgrade);
      step("updated", ".verid/manifest.yaml", () => writeFileSync(manifestFile(project), text));
    } else step("kept", ".verid/manifest.yaml");
    // Without a terminal to ask in, the developer hears what a cook in their terminal would add.
    if (items.length > 0 && flags.upgrade === undefined)
      notes.push(bilingual("init.upgrade", {}), ...items);
    if (flagsGiven) notes.push(bilingual("init.flags_ignored", {}));
  } else {
    // A new manifest needs the developer's choice of mode: the folder only suggests one.
    const facts = projectFacts(project);
    if (flags.mode === undefined)
      throw new VeridError("VERID_BURNT_INIT_NO_MODE", { suggested: suggestMode(facts) });
    const mode = MODES.find((m) => m === flags.mode);
    if (!mode) throw invalid("--mode", "must be prep, recipe or remix");
    const drive = flags.drive === undefined ? undefined : DRIVES.find((d) => d === flags.drive);
    if (flags.drive !== undefined && !drive) throw invalid("--drive", "must be human or auto");

    const suggested = suggestManifest(flags);
    const checked = parseManifest({
      schemaVersion: 1,
      mode,
      roles: DEFAULT_ROLES,
      drive,
      repos: [suggested],
    });
    // A drive the mode cannot take is named as the flag; anything else comes from the others.
    if (!checked.ok)
      throw invalid(
        checked.detail.startsWith("drive:") ? "--drive" : "--test-cmd/--src/--tests",
        checked.detail,
      );
    const text = renderManifest(mode, suggested, DEFAULT_ROLES, drive);
    roles = DEFAULT_ROLES;
    repo = suggested;
    step("created", ".verid/manifest.yaml", () =>
      writeFileSync(manifestFile(project), text, { flag: "wx" }),
    );
  }
  const current = repo ?? existing?.repos[0];
  const seen = current && sees(current);
  if (seen) notes.push(runnersNote(seen.runners));
  // By default vitest and jest pick up Playwright's specs, and Playwright their tests.
  const names = seen ? seen.runners.map((r) => r.name) : [];
  if (names.includes("playwright") && (names.includes("vitest") || names.includes("jest")))
    notes.push(bilingual("cook.e2e_split", {}));
  // verid's agents come from its plugin, installed on each machine apart from the npm package.
  if (Object.values(roles ?? {}).some((agents) => agents?.some((a) => a.startsWith("verid:"))))
    notes.push(bilingual("cook.roles", {}));

  const rel = ".claude/settings.local.json";
  const write = () => {
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(settingsFile, `${JSON.stringify(merged.settings, null, 2)}\n`);
  };
  if (settingsText === null) step("created", rel, write);
  else if (merged.changed) step("updated", rel, write);
  else step("kept", rel);

  // verid's commands in Claude Code's menu, in this machine's language. One that is there is
  // kept: it may be the developer's own edit, or a teammate's in another language.
  const commands = join(project, ".claude", "commands", "verid");
  const missing = COMMANDS.filter((c) => !existsSync(join(commands, `${c}.md`)));
  const lang = language ?? languageOf(project) ?? "en";
  if (missing.length === 0) step("kept", ".claude/commands/verid/");
  else
    step("created", ".claude/commands/verid/", () => {
      mkdirSync(commands, { recursive: true });
      for (const c of missing)
        writeFileSync(join(commands, `${c}.md`), commandFile(lang, c), { flag: "wx" });
    });
  // Set up by hand from the Phase 0 checklist: the hook would run twice. Only a warning, so a
  // shared settings.json that does not parse is Claude Code's to report, not a reason to stop.
  const shared = parseJson(readText(join(project, ".claude", "settings.json")));
  if (hasVeridHooks(shared)) notes.push(bilingual("init.shared_hooks", {}));

  const apply = () => {
    mkdirSync(paths.dir, { recursive: true });
    for (const w of writes) w();
  };
  return { steps, notes, ...(repo !== undefined && { repo }), apply };
}

const COMMANDS = ["tip", "confirm", "peek", "menu"] as const;

/**
 * `/verid:<name>` for Claude Code's menu. The hook reads the line as the developer typed it, so
 * the file only lists the command; its body reaches the agent when the hook lets the prompt
 * through, or when this machine has no verid hooks. The agent never runs one by itself.
 */
function commandFile(lang: Lang, name: (typeof COMMANDS)[number]): string {
  const hint = name === "tip" || name === "confirm" ? t(lang, `command.${name}_hint`, {}) : null;
  return [
    "---",
    `description: ${JSON.stringify(t(lang, `command.${name}`, {}))}`,
    ...(hint === null ? [] : [`argument-hint: ${JSON.stringify(hint)}`]),
    "disable-model-invocation: true",
    "---",
    t(lang, "command.body", {}),
    "",
  ].join("\n");
}

export function projectFacts(project: string): ProjectFacts {
  return { sourceDir: ["src", "lib", "app"].find((d) => isDirectory(join(project, d))) };
}

/** What manifestUpgrade() would change, a line per key: `+` adds globs, `−` drops the key. */
export function upgradeLines(up: ReturnType<typeof manifestUpgrade>): string[] {
  const globs = (list: string[]) => list.map((g) => JSON.stringify(g)).join(", ");
  return [
    ...(up.tests.length > 0 ? [`  + test_globs: ${globs(up.tests)}`] : []),
    ...(up.ignore.length > 0 ? [`  + ignore_globs: ${globs(up.ignore)}`] : []),
    ...(up.e2e.length > 0 ? [`  + e2e_globs: ${globs(up.e2e)}`] : []),
    ...ROLE_NAMES.flatMap((r) =>
      up.roles?.[r] ? [`  + roles.${r}: ${JSON.stringify(up.roles[r])}`] : [],
    ),
    ...(up.dropTestCmd ? ["  − test_cmd"] : []),
  ];
}

/** Which test runners verid sees now, as `vitest, maven (api)`, or that it sees none yet. */
export function runnersNote(runners: readonly Runner[]): string {
  const names = runners.map((r) => (r.dir === "." ? r.name : `${r.name} (${r.dir})`)).join(", ");
  return names ? bilingual("cook.runners", { runners: names }) : bilingual("cook.no_runner", {});
}

/** Parsed JSON; a file that is missing or does not parse counts as absent. */
function parseJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw e;
  }
}
