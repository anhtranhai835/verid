import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { inAgentShell } from "../adapters/agent-environment.js";
import { bannerLines, parsePick, pickLines, type Option } from "../core/cook-ui.js";
import type { MessageKey } from "../core/errors.js";
import {
  DRIVE_NAMES,
  DRIVES,
  LAYOUTS,
  IGNORE_GLOBS,
  MODES,
  RESOURCE_MODES,
  parseManifest,
  suggestManifest,
  suggestMode,
  type InitFlags,
  type Mode,
  type Provider,
  type Repo,
} from "../core/manifest.js";
import { launchable } from "../adapters/architecture.js";
import { fileRole } from "../core/tdd.js";
import { WEEKDAYS } from "../core/iterations.js";
import { setupPreview } from "../core/setup-plan.js";
import { bilingual, setLanguage } from "../adapters/i18n.js";
import {
  isDirectory,
  loadManifest,
  manifestFile,
  missingManifestDefaults,
} from "../adapters/manifest.js";
import { findRunners } from "../adapters/test-runner.js";
import { languageOf, VeridError } from "../adapters/state-store.js";
import { ARCHITECTURES } from "../core/rules.js";
import { checkWorkspaceRoot, detectLayout } from "../adapters/workspace.js";
import { ask, select, type Io } from "../adapters/terminal.js";
import { planCook, projectFacts, servedLine, setupDoneLine, manifestUpgradeLines } from "./init.js";
import type { CliResult } from "./test.js";
import { restorePlugins } from "../adapters/plugin-store.js";

const MODE_EMOJI: Record<Mode, string> = { prep: "🥕", recipe: "📖", remix: "🍲", reheat: "🔥" };

const say = (key: MessageKey, params: Record<string, string> = {}) => bilingual(key, params);

/** Why a typed command or glob cannot go into the manifest, or null when it can. */
function problemWith(repo: Partial<Repo>): string | null {
  const probe = {
    path: ".",
    test_cmd: "{junit}",
    source_globs: ["src/**"],
    test_globs: ["test/**"],
  };
  const r = parseManifest({ schemaVersion: 1, mode: "prep", repos: [{ ...probe, ...repo }] });
  // The detail starts with the field (repos.0.test_cmd: …); the question already names it.
  return r.ok ? null : r.detail.replace(/^[\w.]+: /, "");
}

const PROVIDER_CHOICES = [
  { label: "Claude Code", providers: ["claude-code"] },
  { label: "Codex", providers: ["codex"] },
  { label: "Claude Code + Codex", providers: ["claude-code", "codex"] },
  { label: "Antigravity", providers: ["antigravity"] },
  { label: "Claude Code + Antigravity", providers: ["claude-code", "antigravity"] },
] as const;

/**
 * `verid cook` in the developer's own terminal: the banner, the language, and for a new project
 * the mode and the test runner verid could not see, each picked with the arrow keys. Then the
 * plan, in cooking terms, and for a new manifest what it locks, in words with files of the
 * project as examples: every code file but the tests, so there is nothing to pick. Nothing is
 * written until the developer starts cooking; they can unlock folders first, and Ctrl+C cancels.
 */
export async function interactiveCook(
  project: string,
  io: Io,
  locale: string,
  clock: () => Date = () => new Date(),
): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_INIT_IN_AGENT");
  const line = (text = "") => io.output.write(`${text}\n`);
  const finish = (text: string): CliResult => {
    line(text);
    return { exit: 0, stdout: "", stderr: "" };
  };
  const cancelled = () => finish(say("cook.cancelled"));
  /** Asks until the answer passes `problem`; empty uses a supplied default or cancels. */
  const askUntil = async (
    question: string,
    problem: (answer: string) => string | null,
    emptyValue?: string,
  ) => {
    for (;;) {
      const typed = await ask(io, question);
      if (typed === null) return null;
      const answer = typed || emptyValue;
      if (answer === undefined) return null;
      const wrong = problem(answer);
      if (wrong === null) return answer;
      line(say("cook.invalid", { detail: wrong }));
    }
  };
  /** What the new manifest locks, with up to two files of the project for each kind. */
  const summary = (repo: Repo) => {
    const found = examples(project, repo);
    const shown = (files: string[]) =>
      `     ${files.length > 0 ? say("cook.examples", { files: files.join(", ") }) : say("cook.no_examples")}`;
    line();
    line(`🔒 ${say("cook.lock_code")}`);
    line(shown(found.code));
    line(`🧪 ${say("cook.lock_tests")}`);
    line(shown(found.test));
    line(`📄 ${say("cook.lock_free")}`);
    const unlocked = unlockedOf(repo);
    if (unlocked.length > 0)
      line(`📄 ${say("cook.unlocked", { folders: unlocked.map(shortGlob).join(", ") })}`);
  };
  /**
   * The project's folders that hold code, numbered, ◉ while locked. A number switches one, a
   * name typed unlocks it; Enter keeps them. Resolves the globs unlocked, or null on Ctrl+C.
   */
  const unlock = async (dirs: string[], unlocked: string[]): Promise<string[] | null> => {
    const rows: (Option & { glob: string })[] = [
      ...dirs.map((d) => ({ glob: `${d}/**`, label: `${d}/` })),
      ...unlocked
        .filter((g) => !dirs.some((d) => `${d}/**` === g))
        .map((g) => ({ glob: g, label: shortGlob(g) })),
    ];
    const marks = rows.flatMap((r, i) => (unlocked.includes(r.glob) ? [] : [i]));
    const how = say("cook.unlock_how");
    const question = pickLines(say("cook.unlock_question"), rows, marks, how, io.color);
    for (;;) {
      const answer = await ask(io, question.join("\n"));
      if (answer === null) return null;
      if (answer === "") return unlocked;
      const r = parsePick(
        answer,
        rows.map((o) => o.glob),
      );
      if (!r.ok) {
        line(say("cook.pick_number", { part: r.part, count: String(rows.length) }));
        continue;
      }
      const wrong = r.globs
        .map((g) => ({ part: g, detail: problemWith({ ignore_globs: [g] }) }))
        .find((w) => w.detail !== null);
      if (!wrong)
        return r.globs.reduce(
          (all, g) => (all.includes(g) ? all.filter((x) => x !== g) : [...all, g]),
          unlocked,
        );
      line(say("cook.pick_glob", { part: wrong.part, detail: wrong.detail ?? "" }));
    }
  };

  for (const row of bannerLines(undefined, io.color)) line(row);
  line();

  const langs = ["vi", "en"] as const;
  const offered = languageOf(project) ?? (locale.toLowerCase().startsWith("vi") ? "vi" : "en");
  const picked = await select(
    io,
    "Chọn ngôn ngữ / Choose your language",
    [{ label: "Tiếng Việt" }, { label: "English" }],
    langs.indexOf(offered),
  );
  if (picked === null) return cancelled();
  const lang = langs[picked] ?? "en";
  setLanguage(lang);
  const flags: InitFlags = { lang, src: [], tests: [], ignore: [] };

  const manifest = await loadManifest(project, { readOnly: true, checkPaths: false });
  const detected = manifest ? null : detectLayout(project);
  let layout = manifest?.layout ?? detected?.layout ?? "monorepo";
  let providers = manifest?.providers ?? ["claude-code"];
  let repoPaths = manifest ? manifest.repos.map((repo) => repo.path) : ["."];
  const existing = manifest?.repos[0];
  if (existing) {
    // A manifest from an older verid: the defaults it lacks, added only if the developer says so.
    const items = manifest
      ? manifestUpgradeLines(
          manifest,
          await missingManifestDefaults(readFileSync(manifestFile(project), "utf8")),
        )
      : [];
    if (items.length > 0) {
      for (const item of items) line(item);
      const add = await select(
        io,
        say("cook.upgrade"),
        [{ label: say("cook.upgrade_yes") }, { label: say("cook.upgrade_no") }],
        0,
      );
      if (add === null) return cancelled();
      flags.upgrade = add === 0;
    }
  } else {
    // What verid can see is shown in the plan, not asked; "Change settings" asks everything.
    flags.providers = installedProviders(project);
    if (layout === "workspace")
      try {
        checkWorkspaceRoot(project);
      } catch (error) {
        if (!(error instanceof VeridError)) throw error;
        layout = "monorepo";
      }
    flags.layout = layout;
    repoPaths = layout === "workspace" ? (detected?.repos ?? []).map((repo) => repo.path) : ["."];
    if (!(await askModeAndDrive())) return cancelled();
  }

  /** Why a typed legacy folder cannot be used, or null when it can. */
  function legacyProblem(answer: string): string | null {
    const probe = { source_globs: ["**"], test_globs: ["**"] };
    const r = parseManifest({
      schemaVersion: 1,
      mode: "reheat",
      repos: [
        { path: "app", ...probe },
        { path: answer, role: "legacy", read_only: true, ...probe },
      ],
    });
    if (!r.ok) return r.detail.replace(/^[w.]+: /, "");
    return isDirectory(resolve(project, answer))
      ? null
      : say("cook.legacy_missing", { path: answer });
  }

  /** The mode, then for prep and recipe who runs the kitchen; false when cancelled. */
  async function askModeAndDrive(): Promise<boolean> {
    const facts = projectFacts(project, repoPaths);
    const mode = await select(
      io,
      say("cook.mode"),
      MODES.map((m) => ({
        label: `${MODE_EMOJI[m]} ${m}`,
        hint: say(`cook.mode.${m}`),
      })),
      MODES.indexOf(suggestMode(facts)),
    );
    if (mode === null) return false;
    flags.mode = MODES[mode];
    // Reheat reads a legacy folder that stays untouched; it is asked here when no flag named it.
    if (flags.mode === "reheat") {
      const legacy = await askUntil(say("cook.legacy"), legacyProblem, flags.legacy);
      if (legacy === null) return false;
      flags.legacy = legacy;
    } else delete flags.legacy;
    // Remix has no plan to walk module by module, so only prep and recipe can run on their own.
    if (flags.mode === "remix") {
      delete flags.drive;
      return true;
    }
    const drive = await select(
      io,
      say("cook.drive"),
      DRIVES.map((d) => ({
        label: DRIVE_NAMES[d],
        hint: say(`cook.drive.${DRIVE_NAMES[d]}`),
      })),
      Math.max(
        0,
        DRIVES.findIndex((d) => d === flags.drive),
      ),
    );
    if (drive === null) return false;
    flags.drive = DRIVES[drive];
    return true;
  }

  /** Every setting of a new manifest, each defaulting to the current pick; false when cancelled. */
  async function askSettings(): Promise<boolean> {
    const current = (flags.providers ?? ["claude-code"]).join();
    const provider = await select(
      io,
      say("cook.providers"),
      PROVIDER_CHOICES.map(({ label }) => ({ label })),
      Math.max(
        0,
        PROVIDER_CHOICES.findIndex((c) => c.providers.join() === current),
      ),
    );
    if (provider === null) return false;
    flags.providers = [...PROVIDER_CHOICES[provider]!.providers];
    const children = detectLayout(project, "workspace").repos;
    for (;;) {
      const choice = await select(
        io,
        say("cook.layout"),
        LAYOUTS.map((value) => ({
          label: value,
          hint:
            value === "monorepo"
              ? say("cook.layout.monorepo")
              : children.length
                ? say("cook.layout.workspace", {
                    repos: children.map((repo) => repo.path).join(", "),
                  })
                : say("cook.layout.workspace_none"),
        })),
        LAYOUTS.indexOf(layout),
      );
      if (choice === null) return false;
      const selected = LAYOUTS[choice]!;
      if (selected === "workspace") {
        try {
          checkWorkspaceRoot(project);
          if (!children.length) {
            line(say("cook.invalid", { detail: say("cook.layout.no_children") }));
            continue;
          }
        } catch (error) {
          if (!(error instanceof VeridError)) throw error;
          line(say("cook.invalid", { detail: error.params.detail ?? error.code }));
          continue;
        }
      }
      layout = selected;
      flags.layout = selected;
      repoPaths = selected === "workspace" ? children.map((repo) => repo.path) : ["."];
      break;
    }
    const resources = await select(
      io,
      say("cook.resources"),
      RESOURCE_MODES.map((value) => ({ label: value, hint: say(`cook.resources.${value}`) })),
      flags.resources === "repo" ? 1 : 0,
    );
    if (resources === null) return false;
    flags.resources = RESOURCE_MODES[resources];
    if (!(await askModeAndDrive())) return false;

    if (flags.mode !== "remix") {
      const iterations = await select(
        io,
        say("cook.iterations"),
        [{ label: say("cook.iterations_no") }, { label: say("cook.iterations_yes") }],
        flags.iterations ? 1 : 0,
      );
      if (iterations === null) return false;
      if (iterations === 0) clearIterations();
      else {
        const now = clock();
        const today = [
          String(now.getFullYear()).padStart(4, "0"),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");
        line(say("cook.iterations_fixed"));
        const startDate = await askUntil(
          say("cook.iterations_start_date", { date: today }),
          (value) => {
            const r = parseManifest({
              schemaVersion: 1,
              mode: flags.mode,
              repos: [suggestManifest(flags)],
              iterations: { duration: "2 weeks", start_date: value, demo_day: "Friday" },
            });
            return r.ok ? null : r.detail.replace(/^[\w.]+: /, "");
          },
          today,
        );
        if (startDate === null) return false;
        const end = new Date(`${startDate}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 13);
        flags.iterations = true;
        flags.duration = "2 weeks";
        flags.startDate = startDate;
        flags.demoDay = WEEKDAYS[(end.getUTCDay() + 6) % 7];
      }
    } else clearIterations();

    const architecture = await select(
      io,
      say("cook.architecture"),
      ARCHITECTURES.map((label) => ({ label })),
      Math.max(
        0,
        ARCHITECTURES.findIndex((a) => a === flags.architecture),
      ),
    );
    if (architecture === null) return false;
    flags.architecture = ARCHITECTURES[architecture];

    // verid finds the runners at each run; the plan says which it sees. With none yet, the
    // developer may still type their own command.
    if (runnersSeen().length === 0) {
      const runner = await select(
        io,
        say("cook.runner"),
        [{ label: say("cook.runner_later") }, { label: say("cook.own_command") }],
        flags.testCmd === undefined ? 0 : 1,
      );
      if (runner === null) return false;
      delete flags.testCmd;
      if (runner === 1) {
        const typed = await askUntil(say("cook.own_command"), (c) => problemWith({ test_cmd: c }));
        if (typed === null) return false;
        flags.testCmd = typed;
      }
    }
    return true;
  }

  function clearIterations(): void {
    delete flags.iterations;
    delete flags.duration;
    delete flags.startDate;
    delete flags.demoDay;
  }

  /** The test runners verid sees in the repos now. */
  function runnersSeen(): string[] {
    return repoPaths.flatMap((path) =>
      findRunners(resolve(project, path), layoutOf(suggestManifest(flags))).runners.map(
        (runner) => runner.name,
      ),
    );
  }

  // The folders whose code is locked by default: the ones a developer may unlock.
  let codeDirs: string[] | undefined;
  for (;;) {
    // Everything is checked before the developer is asked to start: a refusal comes first.
    const plan = await planCook(project, flags);
    line();
    line(say("cook.plan"));
    for (const row of setupPreview(plan.files, plan.notes)) line(row);
    const { repo } = plan;
    if (repo) summary(repo);
    if (!manifest) {
      const runners = [...new Set(runnersSeen())];
      const providerLabel = plan.providers.join();
      line();
      line(
        say("cook.found", {
          provider:
            PROVIDER_CHOICES.find((c) => c.providers.join() === providerLabel)?.label ??
            plan.providers.join(" + "),
          layout: plan.layout,
          runner: runners.length ? runners.join(", ") : say("cook.found_no_runner"),
        }),
      );
    }
    line();
    const options = [
      { label: say("cook.start") },
      ...(repo ? [{ label: say("cook.unlock") }] : []),
      ...(manifest ? [] : [{ label: say("cook.change") }]),
      { label: say("cook.cancel") },
    ];
    const go = await select(io, say("cook.confirm"), options, 0, { y: 0, n: options.length - 1 });
    if (go === 0) {
      const fresh = await planCook(project, flags);
      if (fresh.revision !== plan.revision) continue;
      const result = fresh.apply();
      if (result.stdout) line(result.stdout.trimEnd());
      if (result.failed) return { exit: 1, stdout: "", stderr: result.stderr };
      await restorePlugins(project, false, io);
      layout = fresh.layout;
      providers = [...fresh.providers];
      break;
    }
    if (!manifest && go === options.length - 2) {
      if (!(await askSettings())) return cancelled();
      continue;
    }
    if (!(repo && go === 1)) return cancelled();
    codeDirs ??= topDirs(project).filter((d) => fileRole(`${d}/x`, layoutOf(repo)) === "code");
    const unlocked = await unlock(codeDirs, unlockedOf(repo));
    if (unlocked === null) return cancelled();
    flags.ignore = unlocked;
  }
  line();
  line(setupDoneLine(layout, providers));
  line();
  return finish(await servedLine(project));
}

/** The provider whose command is installed, Claude Code first; Claude Code when neither is. */
export const installedProviders = (project: string): Provider[] =>
  !launchable("claude", project) && launchable("codex", project) ? ["codex"] : ["claude-code"];

const layoutOf = (repo: Repo) => ({
  sourceGlobs: repo.source_globs,
  testGlobs: repo.test_globs,
  ignoreGlobs: repo.ignore_globs ?? [],
  e2eGlobs: repo.e2e_globs ?? [],
});

/** What the developer unlocked: the ignored globs beyond verid's own. */
const unlockedOf = (repo: Repo) =>
  (repo.ignore_globs ?? []).filter((g) => !IGNORE_GLOBS.includes(g));

/** `examples/**` reads as the folder `examples/`. */
const shortGlob = (glob: string) => (glob.endsWith("/**") ? glob.slice(0, -2) : glob);

/** The project's top-level folders, hidden ones aside. */
function topDirs(project: string): string[] {
  return readdirSync(project, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/**
 * Up to two files of each kind, in name order, for the summary. Hidden and ignored folders are
 * not opened, and the walk stops after a few thousand entries, so a big project stays quick.
 */
function examples(project: string, repo: Repo): { code: string[]; test: string[] } {
  const layout = layoutOf(repo);
  const found = { code: [] as string[], test: [] as string[] };
  let budget = 5000;
  const walk = (dir: string) => {
    for (const e of readdirSync(join(project, dir), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (--budget < 0 || (found.code.length >= 2 && found.test.length >= 2)) return;
      const rel = dir === "" ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && fileRole(`${rel}/x`, layout) !== "free") walk(rel);
        continue;
      }
      const role = fileRole(rel, layout);
      if (role !== "free" && found[role].length < 2) found[role].push(rel);
    }
  };
  walk("");
  return found;
}
