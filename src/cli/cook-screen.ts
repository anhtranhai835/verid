import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  bannerLines,
  paint,
  parsePick,
  pickLines,
  type Option,
  type Rgb,
} from "../core/cook-ui.js";
import type { MessageKey } from "../core/errors.js";
import {
  DRIVES,
  IGNORE_GLOBS,
  MODES,
  parseManifest,
  suggestManifest,
  suggestMode,
  type InitFlags,
  type Mode,
  type Repo,
} from "../core/manifest.js";
import { fileRole } from "../core/tdd.js";
import { setupPreview } from "../core/setup-plan.js";
import { bilingual, setLanguage } from "../adapters/i18n.js";
import { loadManifest } from "../adapters/manifest.js";
import { findRunners } from "../adapters/test-runner.js";
import { languageOf, VeridError } from "../adapters/state-store.js";
import { restorePlugins } from "../adapters/plugins.js";
import { detectLayout } from "../adapters/workspace.js";
import { ask, select, type Io } from "../adapters/terminal.js";
import { planCook, projectFacts, servedLine, manifestUpgradeLines } from "./init.js";
import type { CliResult } from "./test.js";

const MODE_EMOJI: Record<Mode, string> = { prep: "🥕", recipe: "📖", remix: "🍲" };
const SUCCESS_COLOR: Rgb = [60, 179, 113];

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

/**
 * `verid cook` in the developer's own terminal: the banner, the language, and for a new project
 * the mode and the test runner verid could not see, each picked with the arrow keys. Then the
 * plan, in cooking terms, and for a new manifest what it locks, in words with files of the
 * project as examples: every code file but the tests, so there is nothing to pick. Nothing is
 * written until the developer starts cooking; they can unlock folders first, and Ctrl+C cancels.
 */
export async function interactiveCook(project: string, io: Io, locale: string): Promise<CliResult> {
  if (process.env.CLAUDECODE === "1") throw new VeridError("VERID_BURNT_INIT_IN_AGENT");
  const line = (text = "") => io.output.write(`${text}\n`);
  const finish = (text: string): CliResult => {
    line(text);
    return { exit: 0, stdout: "", stderr: "" };
  };
  const cancelled = () => finish(say("cook.cancelled"));
  const check = (label: string, value: string) =>
    line(`${paint("✔", SUCCESS_COLOR, io.color)} ${label.padEnd(30)} ${value}`);
  /** Asks until the answer passes `problem`, saying what is wrong each time; empty cancels. */
  const askUntil = async (question: string, problem: (answer: string) => string | null) => {
    for (;;) {
      const answer = await ask(io, question);
      if (!answer) return null;
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

  for (const row of bannerLines(io.color)) line(row);
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
  const repoPaths =
    layout === "workspace" ? (detected?.repos.map((repo) => repo.path) ?? []) : ["."];
  const existing = manifest?.repos[0];
  if (existing) {
    // A manifest from an older verid: the defaults it lacks, added only if the developer says so.
    const items = manifest ? manifestUpgradeLines(manifest) : [];
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
    const facts = projectFacts(project, repoPaths);
    const mode = await select(
      io,
      say("cook.mode"),
      MODES.map((m) => ({ label: `${MODE_EMOJI[m]} ${m}`, hint: say(`cook.mode.${m}`) })),
      MODES.indexOf(suggestMode(facts)),
    );
    if (mode === null) return cancelled();
    flags.mode = MODES[mode];

    // Remix has no plan to walk module by module, so only prep and recipe can run on their own.
    if (flags.mode !== "remix") {
      const drive = await select(
        io,
        say("cook.drive"),
        DRIVES.map((d) => ({ label: d, hint: say(`cook.drive.${d}`) })),
        0,
      );
      if (drive === null) return cancelled();
      flags.drive = DRIVES[drive];

      const iterations = await select(
        io,
        say("cook.iterations"),
        [{ label: say("cook.iterations_no") }, { label: say("cook.iterations_yes") }],
        0,
      );
      if (iterations === null) return cancelled();
      if (iterations === 1) {
        const settings = { duration: "2 weeks", start_date: "2000-01-01", demo_day: "Friday" };
        for (const field of ["duration", "start_date", "demo_day"] as const) {
          const answer = await askUntil(say(`cook.iterations_${field}`), (value) => {
            const r = parseManifest({
              schemaVersion: 1,
              mode: flags.mode,
              repos: [suggestManifest(flags)],
              iterations: { ...settings, [field]: value },
            });
            return r.ok ? null : r.detail.replace(/^[\w.]+: /, "");
          });
          if (answer === null) return cancelled();
          settings[field] = answer;
        }
        flags.iterations = true;
        flags.duration = settings.duration;
        flags.startDate = settings.start_date;
        flags.demoDay = settings.demo_day;
      }
    }

    // verid finds the runners at each run; the plan says which it sees. With none yet, the
    // developer may still type their own command.
    if (
      repoPaths.every(
        (path) =>
          findRunners(resolve(project, path), layoutOf(suggestManifest(flags))).runners.length ===
          0,
      )
    ) {
      const runner = await select(
        io,
        say("cook.runner"),
        [{ label: say("cook.runner_later") }, { label: say("cook.own_command") }],
        0,
      );
      if (runner === null) return cancelled();
      if (runner === 1) {
        const typed = await askUntil(say("cook.own_command"), (c) => problemWith({ test_cmd: c }));
        if (typed === null) return cancelled();
        flags.testCmd = typed;
      }
    }
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
    line();
    const go = await select(
      io,
      say("cook.confirm"),
      [
        { label: say("cook.start") },
        ...(repo ? [{ label: say("cook.unlock") }] : []),
        { label: say("cook.cancel") },
      ],
      0,
      { y: 0, n: repo ? 2 : 1 },
    );
    if (go === 0) {
      const fresh = await planCook(project, flags);
      if (fresh.revision !== plan.revision) continue;
      const result = fresh.apply();
      if (result.stdout) line(result.stdout.trimEnd());
      if (result.failed) return { exit: 1, stdout: "", stderr: result.stderr };
      const warnings = await restorePlugins(project, { io });
      if (warnings.length) return { exit: 1, stdout: "", stderr: `${warnings.join("\n")}\n` };
      layout = fresh.layout;
      break;
    }
    if (!(repo && go === 1)) return cancelled();
    codeDirs ??= topDirs(project).filter((d) => fileRole(`${d}/x`, layoutOf(repo)) === "code");
    const unlocked = await unlock(codeDirs, unlockedOf(repo));
    if (unlocked === null) return cancelled();
    flags.ignore = unlocked;
  }
  line();
  line(say(layout === "workspace" ? "workspace.done" : "init.done"));
  line();
  return finish(await servedLine(project));
}

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
