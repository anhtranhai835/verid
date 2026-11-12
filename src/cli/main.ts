import { planned, taskSessions } from "../core/manifest.js";
import { ownEntry } from "../core/station.js";
import type { ErrorCode, MessageKey } from "../core/errors.js";
import { inAgentShell } from "../adapters/agent-environment.js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { autoNextStep, autoPhase, changedServed, securityOf } from "../core/auto.js";
import type { Manifest } from "../core/manifest.js";
import {
  moduleProblem,
  PRODUCT,
  nextStep,
  openModule,
  type Approval,
  type ModuleView,
} from "../core/plan.js";
import { mappedAgents } from "../core/roles.js";
import { FRESH_AUTO, type State } from "../core/state.js";
import { usageLines, type UsageRow } from "../core/cook-ui.js";
import { isCi } from "../core/setup-plan.js";
import { guardsToolCalls } from "../adapters/claude-settings.js";
import { hasCurrentCodexHooks } from "../adapters/codex-settings.js";
import { bilingual, setLanguage, t, veridName, type Lang } from "../adapters/i18n.js";
import { loadManifest, manifestFile } from "../adapters/manifest.js";
import { appendAudit, readAudit } from "../adapters/audit-log.js";
import { usageReport } from "../core/usage.js";
import { contextPacket } from "../core/context-packet.js";
import { findRunners } from "../adapters/test-runner.js";
import { checkSetupPath } from "../adapters/workspace.js";
import { captureWork, compactWorkLog, gitTree, gitView, workLog } from "../adapters/git.js";
import {
  autoFactsOf,
  blockedFile,
  designFile,
  menuLines,
  MODULE_INPUTS,
  openWork,
  peekLines,
  planFile,
  planViews,
  questionLines,
  readDesignHash,
  readPlan,
  researchFile,
  specFile,
  unservedDependencies,
  servedSections,
} from "../adapters/plan-file.js";
import {
  languageOf,
  readState,
  readFileHash,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import type { Io } from "../adapters/terminal.js";
import { interactiveCook } from "./cook-screen.js";
import { doctorCommand } from "./doctor.js";
import { auditLines } from "../adapters/rule-audit.js";
import { writeReviewPacket } from "../adapters/review-packet.js";
import { initCommand, setupCodexCommand } from "./init.js";
import { moduleCommand } from "./module.js";
import { boardCommand } from "./board.js";
import { baselineCommand, lastRefusal, testCommand, type CliResult } from "./test.js";
import { pluginCommand } from "./plugin.js";
import { emitPluginEvent } from "../adapters/plugin-hooks.js";
import { resolveProject } from "../adapters/project.js";
import { projectHook } from "../adapters/hook-wiring.js";
import { stationCommand } from "./station.js";
import { reheatArgs, reheatCommand } from "./reheat.js";
import { confirmParity, gateProblem, serveParity, signParity } from "../adapters/reheat.js";

/** `dist/cli.js`: the command line in, its output and exit code out. */
export async function main(): Promise<void> {
  const r = await runCli(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.exit;
}

/**
 * One verid command run in the current folder; tests call it in process. Exit 2 means verid
 * refused or failed, and nothing counted as evidence.
 */
export async function runCli(args: readonly string[]): Promise<CliResult> {
  let project = process.cwd();
  const [cmd, ...rest] = args;
  setLanguage(languageOf(project));
  let r: CliResult;
  try {
    project = resolveProject(process.cwd(), process.env.CLAUDE_PROJECT_DIR);
    setLanguage(languageOf(project));
    const flags = cmd === "cook" || cmd === "upgrade" ? initFlags(rest, cmd) : null;
    if (flags?.lang === "vi" || flags?.lang === "en") setLanguage(flags.lang);
    // cook sets up the folder it runs in, like `git init`; the others look upwards for .verid.
    // In the developer's own terminal, with no flags, it asks instead of reading flags.
    if (cmd === "cook" && rest.length === 0 && interactive())
      r = await interactiveCook(process.cwd(), terminalIo(), locale());
    else if (flags)
      r = await initCommand(
        cmd === "upgrade" ? project : process.cwd(),
        flags,
        hasTerminal() ? terminalIo() : undefined,
        cmd === "upgrade" ? "upgrade" : "cook",
      );
    else if (cmd === "setup-codex" && rest.length === 0) r = setupCodexCommand();
    else if (cmd === "plugin")
      r = await pluginCommand(project, rest, hasTerminal() ? terminalIo() : undefined);
    else if (cmd === "station") r = await stationCommand(project, rest);
    else if (cmd === "reheat" && reheatArgs(rest)) r = await reheatCommand(project, rest);
    else if (cmd === "taste" && rest.length === 0) r = await testCommand(project);
    else if (cmd === "doctor" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--ci")))
      r = await doctorCommand(project, rest[0] === "--ci");
    else if (cmd === "module" && rest.length === 1) r = await moduleCommand(project, rest[0]!);
    else if (cmd === "module" && rest.length === 2 && ["--quick", "--fix"].includes(rest[1]!))
      r = await moduleCommand(project, rest[0]!, rest[1] === "--quick" ? "quick" : "fix");
    else if (cmd === "board")
      r = await boardCommand(project, rest, (action, task, paritySigned) =>
        action === "order"
          ? approve(project, task)
          : serve(project, task ?? "", { paritySigned: paritySigned === true }),
      );
    else if (cmd === "peek" && rest.length === 0) r = await status(project);
    else if (cmd === "usage") r = usageCommand(project, rest);
    else if (cmd === "context" && contextArgs(rest)) r = await contextCommand(project, rest);
    else if (cmd === "menu" && rest.length === 0) r = await menu(project);
    else if (cmd === "menu" && rest[0] === "--commits" && commitFlags(rest.slice(1)))
      r = await commits(project, rest.includes("--file"), rest.includes("--compact"));
    else if (cmd === "garnish" && rest.length === 0) r = refactor(project);
    else if (cmd === "halt") r = halt(project, rest);
    else if (cmd === "resume" && rest.length === 0) r = resume(project);
    else if (cmd === "stock" && rest.length === 0) r = await baselineCommand(project);
    else if (cmd === "order" && rest.length <= 1) r = await approve(project, rest[0]);
    else if (cmd === "serve" && serveArgs(rest)) {
      const names = rest.filter((arg) => arg !== "--parity-signed");
      r = await serve(project, names[0] as string, {
        paritySigned: names.length < rest.length,
        ...(hasTerminal() && { io: terminalIo() }),
      });
    } else if (cmd === undefined) r = usage(project, null, await helpNextStep(project));
    else if (["help", "--help", "-h"].includes(cmd)) r = usage(project, null);
    else r = usage(project, misused(cmd, rest));
  } catch (err) {
    const code: ErrorCode = err instanceof VeridError ? err.code : "VERID_BURNT_INTERNAL";
    const params =
      err instanceof VeridError
        ? err.params
        : { detail: err instanceof Error ? err.message : String(err) };
    // Before cook there is no language to follow: say it once, in the system's.
    const before = languageOf(project) === null && !existsSync(manifestFile(project));
    const text = before ? t(systemLang(), code, params) : bilingual(code, params);
    r = { exit: 2, stdout: "", stderr: `verid [${code}]\n${text}\n` };
  }
  return r;
}

const COOK_OPTIONS = {
  workflow: { type: "string" },
  resources: { type: "string" },
  mode: { type: "string" },
  drive: { type: "string" },
  architecture: { type: "string" },
  layout: { type: "string" },
  legacy: { type: "string" },
  target: { type: "string" },
  provider: { type: "string", multiple: true },
  iterations: { type: "boolean" },
  duration: { type: "string" },
  "start-date": { type: "string" },
  "demo-day": { type: "string" },
  lang: { type: "string" },
  "test-cmd": { type: "string" },
  src: { type: "string", multiple: true },
  tests: { type: "string", multiple: true },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean" },
} as const;
const UPGRADE_OPTIONS = { "dry-run": COOK_OPTIONS["dry-run"], yes: COOK_OPTIONS.yes };

/** `--mode`, `--drive`, `--test-cmd`, `--src` and `--tests` (repeatable); null when anything else is passed. */
function initFlags(args: string[], command: "cook" | "upgrade") {
  try {
    if (command === "upgrade") parseArgs({ args, options: UPGRADE_OPTIONS });
    const { values } = parseArgs({ args, options: COOK_OPTIONS });
    return {
      workflow: values.workflow,
      resources: values.resources,
      mode: values.mode,
      drive: values.drive,
      architecture: values.architecture,
      layout: values.layout,
      legacy: values.legacy,
      target: values.target,
      providers: values.provider,
      iterations: values.iterations,
      duration: values.duration,
      startDate: values["start-date"],
      demoDay: values["demo-day"],
      lang: values.lang,
      testCmd: values["test-cmd"],
      src: values.src ?? [],
      tests: values.tests ?? [],
      dryRun: values["dry-run"],
      yes: values.yes,
    };
  } catch {
    return null;
  }
}

function usageCommand(project: string, args: string[]): CliResult {
  const modules = args.filter((arg) => !arg.startsWith("--"));
  if (
    modules.length > 1 ||
    args.filter((arg) => arg === "--json").length > 1 ||
    args.some((arg) => arg.startsWith("-") && arg !== "--json")
  )
    return usage(project, {
      key: "usage.unexpected",
      params: { command: "usage", args: args.join(" ") },
    });
  const rows = usageReport(readAudit(statePaths(project).audit)).filter(
    (row) => modules.length === 0 || row.module === modules[0],
  );
  if (args.includes("--json"))
    return { exit: 0, stdout: JSON.stringify(rows, null, 2) + "\n", stderr: "" };
  const lang = languageOf(project) ?? systemLang();
  const lines = [
    t(lang, "ledger.columns", {}),
    ...rows.map((row) =>
      [
        row.module,
        row.sessions,
        row.taste,
        row.denied,
        row.stopBlocked,
        row.chars,
        row.tokens
          ? `${row.tokens.input}/${row.tokens.cached}/${row.tokens.output} (${row.tokens.total})`
          : t(lang, "ledger.unavailable", {}),
      ].join(" | "),
    ),
    t(lang, "ledger.scope", {}),
  ];
  return { exit: 0, stdout: lines.join("\n") + "\n", stderr: "" };
}

/** `[module] [--ac <id>]`, either order, nothing else. */
function contextArgs(
  args: string[],
): { module?: string | undefined; ac?: string | undefined } | null {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ac: { type: "string" } },
      allowPositionals: true,
    });
    return positionals.length > 1 ? null : { module: positionals[0], ac: values.ac };
  } catch {
    return null;
  }
}

/** The task packet: read-only, built from the files each call, never cached. */
async function contextCommand(project: string, args: string[]): Promise<CliResult> {
  const { module: wanted, ac } = contextArgs(args)!;
  const state = readState(statePaths(project));
  let target = wanted ?? state.kanban.active?.module ?? state.auto.work?.module;
  if (target === undefined) {
    const current = readPlan(project, false, false, servedSections(state));
    if (current?.ok) target = openModule(planViews(project, current, state))?.name;
  }
  const { plan, name, module, manifest } = await planModule(project, "context", target);
  const views = planViews(project, plan, state);
  const read = (rel: string) => {
    const file = join(project, ...rel.split("/"));
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  const base = `.verid/artifacts/03-modules/${name}`;
  const files = MODULE_INPUTS.map((input) => {
    checkSetupPath(project, `${base}/${input}`);
    const text = read(`${base}/${input}`);
    return {
      path: input,
      state:
        text === null
          ? "missing"
          : !text.trim()
            ? "empty"
            : text.includes("[NEEDS CLARIFICATION")
              ? "unresolved"
              : "ok",
    } as const;
  });
  const spec = read(".verid/spec.md");
  const log = read(`.verid/log/${name}.md`)
    ?.split(/\r?\n/)
    .findLast((line) => line.trim() !== "");
  const commands = manifest.repos.flatMap((repo) => {
    if (repo.role === "legacy") return [];
    if (repo.test_cmd !== undefined) return [repo.test_cmd];
    try {
      return findRunners(resolve(project, ...repo.path.split(/[/\\]/)), {
        sourceGlobs: repo.source_globs,
        testGlobs: repo.test_globs,
        ignoreGlobs: repo.ignore_globs ?? [],
      }).runners.map((runner) => runner.name);
    } catch {
      return [];
    }
  });
  const stdout = contextPacket({
    module,
    plan: { path: ".verid/plan.md", sha: plan.hashes[name] ?? null },
    spec:
      spec === null
        ? null
        : { path: ".verid/spec.md", text: spec, sha: readFileHash(specFile(project)) },
    design: existsSync(designFile(project))
      ? { path: ".verid/design.md", sha: readDesignHash(project) }
      : null,
    needs: (module.depends ?? []).map((dep) => ({
      name: dep,
      phase: views.find((view) => view.name === dep)?.phase ?? "not in plan",
    })),
    files,
    dossier: base,
    run: commands.length > 0 ? `verid taste (${commands.join(", ")})` : "verid taste",
    log: { path: `.verid/log/${name}.md`, last: log ? log.trim() : null },
    ...(ac !== undefined && { ac }),
  });
  return { exit: 0, stdout, stderr: "" };
}

async function status(project: string): Promise<CliResult> {
  const state = readState(statePaths(project));
  const manifest = await loadManifest(project);
  // A teammate who cloned the project but never ran cook has state and manifest, and no hooks.
  const hook = projectHook(project);
  const claude = ["settings.local.json", "settings.json"].some((f) =>
    guardsToolCalls(readJson(join(project, ".claude", f)), hook),
  );
  const guarded = (manifest?.providers ?? ["claude-code"]).every((provider) =>
    provider === "codex"
      ? hasCurrentCodexHooks(readJson(join(project, ".codex", "hooks.json")), hook)
      : claude,
  );
  const stderr = guarded ? "" : `${bilingual("status.no_hooks", {})}\n`;
  // The gate follows the manifest, not state: say so when it is off (an invalid one throws).
  const lines = peekLines(
    project,
    manifest?.mode ?? null,
    state,
    manifest?.roles,
    manifest?.drive,
    manifest ?? undefined,
  );
  const refused = lastRefusal(project, state.tdd.last_run);
  if (refused)
    lines.push(
      bilingual("status.last_refused", { run: refused.run, code: refused.code }),
      bilingual(refused.code, refused.params),
      ...(refused.hint
        ? [bilingual(refused.hint.key, { ...refused.hint.params, command: "taste" })]
        : []),
    );
  return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr };
}

type Misuse = { key: MessageKey; params: Record<string, string> };

// How many arguments each command takes after its name; cook takes flags.
const ARGS: Record<string, number> = {
  usage: 2,
  context: 3,
  module: 1,
  doctor: 0,
  taste: 0,
  peek: 0,
  menu: 0,
  garnish: 0,
  resume: 0,
  stock: 0,
  order: 1,
  serve: 1,
  board: 0,
};

/** What verid could not run in a command line: the command, or the words it did not expect. */
function misused(cmd: string, rest: string[]): Misuse {
  if (cmd === "cook" || cmd === "upgrade") {
    const options = cmd === "upgrade" ? UPGRADE_OPTIONS : COOK_OPTIONS;
    const { tokens } = parseArgs({
      args: rest,
      options,
      strict: false,
      tokens: true,
    });
    const odd = tokens.flatMap((tk) =>
      tk.kind === "positional"
        ? [tk.value]
        : tk.kind === "option" && !(tk.name in options)
          ? [tk.rawName]
          : [],
    );
    return {
      key: "usage.unexpected",
      params: { command: cmd, args: (odd.length > 0 ? odd : rest).join(" ") },
    };
  }
  if (cmd === "reheat")
    return { key: "usage.unexpected", params: { command: cmd, args: rest.join(" ") || "(none)" } };
  const max = ARGS[cmd];
  if (max === undefined) return { key: "usage.unknown", params: { command: cmd } };
  if (cmd === "serve" && rest.length === 0) return { key: "usage.no_module", params: {} };
  return { key: "usage.unexpected", params: { command: cmd, args: rest.slice(max).join(" ") } };
}

/**
 * `verid` alone, or asking for help: the commands as a menu, on stdout. A command line verid
 * cannot run gets the same menu as a refusal, on stderr, below what it did not understand.
 * Before cook has set a language, the system's is used: a table in two languages at once would
 * be hard to read.
 */
function usage(project: string, wrong: Misuse | null, next?: string): CliResult {
  const lang: Lang = languageOf(project) ?? systemLang();
  const say = (key: MessageKey) => t(lang, key, {});
  // The table reads `verid`; when verid is not on PATH one line above it names what runs it.
  const full = veridName();
  const v = "verid";
  const dev = say("usage.developer");
  // Outside a real terminal, cook asks nothing and needs the mode: never point to what fails.
  const cook = interactive() ? `${v} cook` : `${v} cook --mode <prep|recipe|remix>`;
  const rows: UsageRow[] = [
    // The three everyday commands first, then the gate commands as a second group.
    { emoji: "🔪", command: cook, what: say("usage.cook"), who: dev },
    { emoji: "🩺", command: `${v} doctor [--ci]`, what: say("usage.doctor") },
    { emoji: "📋", command: `${v} menu [--commits [--file [--compact]]]`, what: say("usage.menu") },
    {
      emoji: "⬆️",
      command: `${v} upgrade [--dry-run] [--yes]`,
      what: say("usage.upgrade"),
      who: dev,
      group: say("usage.group"),
    },
    {
      emoji: "📁",
      command: `${v} module <name> [--quick|--fix]`,
      what: say("usage.module"),
      who: "prep, recipe",
    },
    { emoji: "👅", command: `${v} taste`, what: say("usage.taste") },
    { emoji: "👀", command: `${v} peek`, what: say("usage.peek") },
    { emoji: "📊", command: `${v} usage [module] [--json]`, what: say("usage.ledger") },
    { emoji: "🗂️", command: `${v} context [module] [--ac <id>]`, what: say("usage.context") },
    {
      emoji: "▦",
      command: `${v} board [--port <number>] [--no-open]`,
      what: say("usage.board"),
      who: dev,
    },
    {
      emoji: "🧾",
      command: `${v} order [module]`,
      what: say("usage.order"),
      who: `${dev} · prep, recipe`,
    },
    {
      emoji: "🍽️",
      command: `${v} serve <module>`,
      what: say("usage.serve"),
      who: `${dev} · prep, recipe`,
    },
    { emoji: "🥫", command: `${v} stock`, what: say("usage.stock"), who: `${dev} · remix` },
    { emoji: "🌿", command: `${v} garnish`, what: say("usage.garnish"), who: dev },
    { emoji: "🛑", command: `${v} halt [reason]`, what: say("usage.halt"), who: dev },
    { emoji: "▶️", command: `${v} resume`, what: say("usage.resume"), who: dev },
  ];
  rows.push({
    emoji: "🍳",
    command: `${v} station <module>|list|close <module>`,
    what: say("usage.station"),
    who: dev,
  });
  rows.push({
    emoji: "🔥",
    command: `${v} reheat <inventory|extract <unit>|gate <unit>>`,
    what: say("usage.reheat"),
    who: "reheat",
  });
  rows.push({
    emoji: "🧩",
    command: `${v} plugin <add|remove|list|doctor>`,
    what: say("usage.plugin"),
    who: dev,
  });
  const tty = wrong ? process.stderr.isTTY : process.stdout.isTTY;
  const color = Boolean(tty) && !process.env.NO_COLOR;
  const notes = [...(next ? [next] : []), ...(full === v ? [] : [`${v} = ${full}`])];
  const lines = usageLines(say("usage.tagline"), rows, say("usage.in_claude"), color, notes);
  lines.push("", `   ${say("usage.cook_options")}`);
  if (!wrong) return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  const text = [t(lang, wrong.key, wrong.params), ...lines].join("\n");
  return { exit: 2, stdout: "", stderr: `${text}\n` };
}

/** The last line of `verid menu`, or nothing when there is no usable plan: help never fails on it. */
async function helpNextStep(project: string): Promise<string | undefined> {
  try {
    const manifest = await loadManifest(project);
    if (!manifest) return undefined;
    const state = readState(statePaths(project));
    return menuLines(project, manifest.mode, state, manifest.roles, manifest.drive, manifest).at(
      -1,
    );
  } catch {
    return undefined;
  }
}

/** `verid menu`: the plan's modules, where each one stands, and the one next step. */
async function menu(project: string): Promise<CliResult> {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const state = readState(statePaths(project));
  const lines = menuLines(project, manifest.mode, state, manifest.roles, manifest.drive, manifest);
  return {
    exit: 0,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
  };
}

/** The flags after `menu --commits`: `--file`, and `--compact` only with it, each at most once. */
const commitFlags = (flags: string[]): boolean =>
  new Set(flags).size === flags.length &&
  flags.every((f) => f === "--file" || f === "--compact") &&
  (!flags.includes("--compact") || flags.includes("--file"));

/**
 * `verid menu --commits`: the open module's work as Git shows it, for a reviewer that cannot run
 * Git: every commit since the recorded start with its message and diff, then what is uncommitted.
 * With --file, write the evidence to a protected, reviewer-readable packet and print its path.
 * With --compact too, the packet is one diff from the base and the per-commit history goes to
 * `history.md` beside it.
 * Secret files and verid's state are never shown.
 */
async function commits(project: string, file = false, compact = false): Promise<CliResult> {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const open = openWork(project, manifest, readState(statePaths(project)));
  const say = (text: string) => ({ exit: 0 as const, stdout: `${text}\n`, stderr: "" });
  if (open === null) return say(bilingual("commits.none", {}));
  const { module, work } = open;
  const history =
    work === undefined
      ? [bilingual("commits.no_record", { module })]
      : Object.keys(work).length === 0
        ? [bilingual("git.no_history", { module })]
        : workLog(project, work);
  const short =
    compact && work !== undefined && Object.keys(work).length > 0
      ? compactWorkLog(project, work)
      : undefined;
  const text = [
    `verid: work history of module ${module}`,
    ...(file
      ? [
          "Plan: .verid/plan.md",
          "Design: .verid/design.md",
          "Read changed and new files at their paths; the snapshot below may be truncated.",
        ]
      : []),
    ...(short ?? history),
  ].join("\n");
  const full = `verid: work history of module ${module}\n${history.join("\n")}\n`;
  return say(
    file
      ? writeReviewPacket(project, `${text}\n`, short === undefined ? undefined : full)
      : work === undefined || Object.keys(work).length === 0
        ? history.join("\n")
        : text,
  );
}

/**
 * `verid garnish`: the developer declares that this conversation only refactors. A new
 * conversation starts in RAW (hook.ts), which would lock production code for a pure refactor;
 * only the developer may open it, and only while every test passed in the last run.
 */
function refactor(project: string): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_REFACTOR_IN_AGENT");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const { last_run, failing } = state.tdd;
    if (last_run === null || failing.length > 0)
      throw new VeridError("VERID_BURNT_REFACTOR_NOT_GREEN");
    if (state.tdd.state !== "PLATED") {
      appendAudit(paths.audit, { event: "tdd_refactor", from: state.tdd.state });
      writeState(paths, {
        ...state,
        tdd: { ...state.tdd, state: "PLATED", rev: state.tdd.rev + 1 },
      });
    }
    return {
      exit: 0,
      stdout: `verid: TDD PLATED · last run ${last_run}\n${bilingual("status.plated", {})}\n`,
      stderr: "",
    };
  });
}

/**
 * `verid halt [reason]`: the developer's kill switch. Until `verid resume`, the hook denies every
 * tool call of every agent, past any `/verid tip`, and holds no Stop. Halting again replaces the
 * reason.
 */
function halt(project: string, words: readonly string[]): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_HALT_IN_AGENT");
  const reason = words.join(" ").trim() || "no reason given";
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    // Audit first: if it fails, state is untouched and verid is not halted.
    appendAudit(paths.audit, { event: "halted", reason });
    writeState(paths, { ...state, halted: { at: new Date().toISOString(), reason } });
    return {
      exit: 0,
      stdout: `verid: halted · ${reason}\n${bilingual("halt.done", {})}\n`,
      stderr: "",
    };
  });
}

/** `verid resume`: lifts `verid halt`; the agent's calls are judged by every rule again. */
function resume(project: string): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_HALT_IN_AGENT");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    if (state.halted === null) return { exit: 0, stdout: "verid: not halted\n", stderr: "" };
    appendAudit(paths.audit, { event: "resumed" });
    writeState(paths, { ...state, halted: null });
    return { exit: 0, stdout: `verid: resumed\n${bilingual("resume.done", {})}\n`, stderr: "" };
  });
}

/**
 * `verid order [module]` (prep and recipe, developer only): record one module of
 * `.verid/plan.md` as the part the tests have to cover now. The approval holds for the module's
 * section as it is, and only one module is open at a time. The file is read once, so the hash and
 * the AC list describe the same bytes.
 */
async function approve(project: string, wanted: string | undefined): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_APPROVE_IN_AGENT");
  const manifest = await loadManifest(project);
  if (manifest?.drive === "auto") return signAuto(project, manifest, wanted);
  const { plan, name, module } = await planModule(project, "order", wanted);
  const problem = moduleProblem(module);
  if (problem)
    throw new VeridError("VERID_BURNT_PLAN_INVALID", { path: planFile(project), detail: problem });
  // Record the design for advisory change detection; the module section remains signed.
  const design = readDesignHash(project);
  if (design === null)
    throw new VeridError("VERID_BURNT_DESIGN_MISSING", { path: designFile(project) });

  const sha256 = plan.hashes[name] as string;
  const paths = statePaths(project);
  // Where the module's work begins in each Git root: main's commit now. Read before the lock.
  const captured = captureWork(project, manifest!);
  const result = withLock(paths, () => {
    const state = readState(paths);
    const views = planViews(project, plan, state);
    const open = openModule(views.filter((view) => !ownEntry(state.stations, view.name)));
    const kanban = manifest && taskSessions(manifest);
    const specHash = kanban ? readFileHash(specFile(project)) : null;
    if (kanban && specHash === null)
      throw new VeridError("VERID_BURNT_PLAN_NO_SPEC", { target: specFile(project) });
    if (kanban && state.kanban.active && state.kanban.active.module !== name)
      throw new VeridError("VERID_BURNT_MODULE_OPEN", { module: state.kanban.active.module });
    if (ownEntry(state.stations, name))
      throw new VeridError("VERID_BURNT_STATION_INVALID", {
        detail: `module already has a station: ${name}`,
      });
    const keepTask =
      kanban &&
      state.kanban.active?.module === name &&
      state.kanban.active.spec_sha256 === specHash &&
      state.modules[name]?.sha256 === sha256 &&
      state.modules[name]?.design_sha256 === design;
    const taskState = kanban
      ? {
          kanban: {
            ...state.kanban,
            active: keepTask
              ? state.kanban.active
              : { module: name, session: null, spec_sha256: specHash! },
          },
          ...(!keepTask
            ? {
                tdd: {
                  ...state.tdd,
                  state: "RAW" as const,
                  last_run: null,
                  failing: [],
                  rev: state.tdd.rev + 1,
                  dirty: false,
                  passed_acs: [],
                  passed_e2e_acs: [],
                  stub: false,
                  crashed: [],
                },
              }
            : {}),
        }
      : {};
    // The product module says the whole product works, so every other module is done first.
    const waiting = views.filter((v) => v.name !== PRODUCT && v.phase !== "done");
    if (name === PRODUCT && waiting.length > 0)
      throw new VeridError("VERID_BURNT_PRODUCT_TOO_EARLY", {
        modules: waiting.map((v) => v.name).join(", "),
      });
    if (open && open.name !== name)
      throw new VeridError("VERID_BURNT_MODULE_OPEN", { module: open.name });
    // A re-order of the open module keeps where its work began, so earlier commits stay checked.
    const before = state.modules[name];
    const kept = before?.served_at === null ? before.work : undefined;
    const work = kept ?? ("detail" in captured ? {} : captured);
    // A legacy unit is ordered only on a gate that passed on what it holds now.
    const gate = gateProblem(project, state, name);
    if (gate !== null)
      throw new VeridError("VERID_BURNT_REHEAT_GATE", { module: name, detail: gate });
    // Audit first: if it fails, state is untouched and nothing was approved.
    appendAudit(paths.audit, {
      event: "plan_approved",
      module: name,
      sha256,
      acs: module.acs.length,
    });
    // Another module's approval that was never served is stale here (its section changed, or the
    // check above would have refused): drop it, or reverting that section would reopen it next to
    // this one. A new approval is a new chance for Stop to hold the conversation for this module,
    // and needs a new review.
    const served = Object.entries(state.modules).filter(
      ([other, a]) =>
        other !== name && (a.served_at !== null || ownEntry(state.stations, other) !== undefined),
    );
    writeState(paths, {
      ...state,
      ...taskState,
      modules: {
        ...Object.fromEntries(served),
        [name]: {
          sha256,
          acs: module.acs,
          at: new Date().toISOString(),
          served_at: null,
          design_sha256: design,
          work,
        },
      },
      ac_stop_session: null,
      review: null,
      security: null,
      review_epoch: state.review_epoch + 1,
      security_epoch: state.security_epoch + 1,
    });
    // Dependencies are advice: an order before them is recorded and said, never refused.
    const unserved = unservedDependencies(
      views.find((v) => v.name === name)!,
      views,
    );
    if (unserved.length > 0)
      appendAudit(paths.audit, {
        event: "warning",
        code: "ORDER_DEPENDS",
        target: name,
        reason: `${unserved.join(", ")} not served`,
      });
    const acs = module.acs.join(", ");
    const count = module.acs.length;
    const warned =
      unserved.length > 0
        ? `verid: module ${name} waits for ${unserved.join(", ")}, which is not served yet\n`
        : "";
    return {
      exit: 0,
      stdout: `verid: module ${name} approved · ${count} acceptance ${count === 1 ? "criterion" : "criteria"}\n${warned}${bilingual("approve.done", { module: name, acs })}\n`,
      stderr: "",
    };
  });
  result.stderr += await emitPluginEvent(project, "after-order", {
    module: name,
    acs: module.acs,
    dossier: `.verid/artifacts/03-modules/${name}`,
  });
  return result;
}

/**
 * `verid order` in an auto drive (developer only): sign the research and the design as they are
 * now, which starts the drive, and continue one that was stuck. The drive opens and serves the
 * modules itself, so a module name is refused. Signing starts every loop over and drops the review
 * of the open module; the reviewed plan stands only if neither file changed since the last
 * signature. A served module whose section of the plan was edited since is reopened, and one the
 * plan no longer has is forgotten. Each file is read once, so the hashes signed and the next step
 * describe the same bytes. A closed module waiting for its merge is released when the drive is
 * not stuck: the developer acknowledges an integration that exact matching cannot see, such as a
 * squash with a resolved conflict. Where any other module's work began, and its branch, stay as
 * recorded.
 */
function signAuto(project: string, manifest: Manifest, wanted: string | undefined): CliResult {
  if (wanted !== undefined) throw new VeridError("VERID_BURNT_AUTO_ORDER_MODULE");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const facts = autoFactsOf(
      project,
      state,
      manifest.iterations !== undefined,
      planned(manifest),
      manifest.stations,
    );
    const { researchHash, specHash, designHash } = facts;
    if (researchHash === null)
      throw new VeridError("VERID_BURNT_RESEARCH_MISSING", { path: researchFile(project) });
    if (designHash === null)
      throw new VeridError("VERID_BURNT_DESIGN_MISSING", { path: designFile(project) });

    const before = state.auto.signed;
    // A changed spec, like changed research or design, sends the plan back to review.
    const unchanged =
      before?.research_sha256 === researchHash &&
      before.spec_sha256 === specHash &&
      before.design_sha256 === designHash;
    const edited = facts.plan?.ok ? changedServed(facts.plan.hashes, state.modules) : [];
    // An order that resumes a stuck drive keeps a module's merge wait; one given while it is not
    // stuck is the developer's acknowledgement that the module was integrated.

    const next: State = {
      ...state,
      modules: Object.fromEntries(
        Object.entries(state.modules).filter(([m]) => !edited.includes(m)),
      ),
      review: null,
      security: null,
      review_epoch: state.review_epoch + 1,
      security_epoch: state.security_epoch + 1,
      auto: {
        ...FRESH_AUTO,
        signed: {
          research_sha256: researchHash,
          spec_sha256: specHash,
          design_sha256: designHash,
          at: new Date().toISOString(),
          git: gitView(project) !== null,
          git_repos: gitTree(project, manifest).presence,
        },
        plan_sha256: unchanged ? state.auto.plan_sha256 : null,
        work: state.auto.work,
      },
    };
    // blocked.md is removed below, so it is not read as a reason to stop. Nothing is committed or
    // reviewed yet, so the step does not depend on git.
    const phase = autoPhase({
      ...facts,
      auto: next.auto,
      approvals: next.modules,
      blockedFile: null,
    });
    const step = autoNextStep(phase, true, true, null);
    // Audit first: if it fails, state is untouched and nothing was signed.
    appendAudit(paths.audit, {
      event: "auto_signed",
      research_sha256: researchHash,
      spec_sha256: specHash,
      design_sha256: designHash,
    });
    writeState(paths, next);
    rmSync(blockedFile(project), { force: true });
    const lines = [
      `verid: auto signed · research ${researchHash.slice(0, 8)} · spec ${specHash?.slice(0, 8) ?? "none"} · design ${designHash.slice(0, 8)}`,
      bilingual("auto.signed", {}),
      bilingual(step.key, { ...mappedAgents(manifest.roles), ...step.params }),
    ];
    return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  });
}

/**
 * `verid serve <module>` (prep and recipe, developer only): close the open module once its
 * evidence holds. The developer vouches for the review; verid checks the tests: every AC of the
 * module passed in the last valid run, that run passed as a whole, and nothing changed since.
 */
async function serve(
  project: string,
  wanted: string,
  options: { paritySigned?: boolean; io?: Io } = {},
): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_SERVE_IN_AGENT");
  // Before the plan is read: auto refuses even where there is no plan yet.
  const drive = await loadManifest(project);
  if (drive?.drive === "auto") {
    // The one thing the developer does in a drive that serves by itself: sign a unit's parity.
    if (options.paritySigned && drive.mode === "reheat") {
      const sha256 = signParity(project, wanted);
      return {
        exit: 0,
        stdout: `verid: parity of ${wanted} signed · ${sha256.slice(0, 8)}
${bilingual("reheat.parity_signed", { module: wanted })}
`,
        stderr: "",
      };
    }
    throw new VeridError("VERID_BURNT_AUTO_SERVE");
  }
  const { plan, name, manifest } = await planModule(project, "serve", wanted);
  const paths = statePaths(project);
  // A terminal asks before the lock is taken; what the developer said yes to is bound to its hash.
  const confirmed =
    manifest.mode === "reheat" && !options.paritySigned && options.io
      ? await confirmParity(project, name, options.io)
      : null;
  const { result, reviewFile } = withLock(paths, () => {
    const state = readState(paths);
    const views = planViews(project, plan, state);
    const view = views.find((v) => v.name === name) as ModuleView;
    if (ownEntry(state.stations, name))
      throw new VeridError("VERID_BURNT_STATION_INVALID", {
        detail: "serve inside the station, then station close from the primary worktree",
      });
    if (
      taskSessions(manifest) &&
      (state.kanban.active?.module !== name ||
        state.kanban.active.spec_sha256 !== readFileHash(specFile(project)) ||
        state.modules[name]?.sha256 !== plan.hashes[name] ||
        state.modules[name]?.design_sha256 !== readFileHash(designFile(project)))
    )
      throw new VeridError("VERID_BURNT_TASK_SESSION", {
        detail_key: "task_session.serve_changed",
      });
    // The reason is a message of its own, so it comes in the developer's language.
    const reviewers = (manifest.roles?.reviewer ?? []).join(", ");
    const notReady = (reason: MessageKey, acs = "") =>
      new VeridError("VERID_BURNT_SERVE_NOT_READY", {
        module: name,
        detail_key: reason,
        acs,
        reviewer: reviewers,
        security: (manifest.roles?.security ?? []).join(", "),
      });
    if (view.phase === "planned") throw notReady("serve.not_approved");
    if (view.phase === "done") throw notReady("serve.already");
    if (view.uncovered.length > 0) throw notReady("serve.uncovered", view.uncovered.join(", "));
    const { last_run, failing, dirty } = state.tdd;
    if (last_run === null) throw notReady("serve.no_run");
    if (failing.length > 0) throw notReady("serve.failed");
    if (dirty) throw notReady("serve.dirty");
    // The developer reads a review by the mapped reviewer, recorded after the last change.
    if (reviewers === "") throw notReady("serve.no_reviewer");
    const { review } = state;
    if (review?.module !== name) throw notReady("serve.no_review");
    // A recorded failure never counts as approval.
    if (review.verdict !== "pass") throw notReady("serve.review_failed");
    // A mapped security reviewer must pass the module too, after the last change.
    const security = securityOf(state, manifest.roles);
    if (security !== undefined && !(security?.module === name && security.verdict === "pass"))
      throw notReady("serve.no_security");

    // A legacy unit also needs its gate and the developer's signature on its parity record.
    const parity = serveParity(project, state, name, {
      flag: options.paritySigned === true,
      confirmed,
    });
    const served = { ...(state.modules[name] as Approval), served_at: new Date().toISOString() };
    const next = {
      ...state,
      ...(parity.signedNow && parity.reheat ? { reheat: parity.reheat } : {}),
      modules: { ...state.modules, [name]: served },
      ...(taskSessions(manifest) ? { kanban: { ...state.kanban, active: null } } : {}),
    };
    // The next step is worked out before anything is written, so a file that cannot be read
    // fails the command without serving half of it.
    const after = planViews(project, plan, state, next.modules);
    const questions = questionLines(project);
    const step = nextStep(
      existsSync(researchFile(project)),
      existsSync(designFile(project)),
      after,
      questions.length > 0,
      existsSync(specFile(project)),
    );
    // Audit first: if it fails, state is untouched and the module stays open.
    if (parity.signedNow) appendAudit(paths.audit, { event: "parity_signed", module: name });
    appendAudit(paths.audit, { event: "module_served", module: name });
    writeState(paths, next);
    const lines = [
      `verid: module ${name} served`,
      bilingual("serve.done", { module: name }),
      bilingual("serve.review", { agent: review.agent_type, file: review.file }),
      ...(security
        ? [bilingual("serve.security", { agent: security.agent_type, file: security.file })]
        : []),
      ...auditLines(project, manifest, state),
      ...questions,
      ...(taskSessions(manifest) ? [bilingual("task_session.stop", {})] : []),
      bilingual(step.key, "module" in step ? { module: step.module } : {}),
    ];
    return {
      result: { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" },
      reviewFile: review.file,
    };
  });
  result.stderr += await emitPluginEvent(project, "after-serve", {
    module: name,
    commit: gitView(project)?.head ?? null,
    review: reviewFile,
  });
  return result;
}

/** `serve <module>`, with `--parity-signed` before or after it, once at most. */
const serveArgs = (args: readonly string[]): boolean => {
  const names = args.filter((arg) => arg !== "--parity-signed");
  return names.length === 1 && args.length - names.length <= 1;
};

/**
 * What `order` and `serve` share: a prep or recipe manifest, a readable plan, and the module
 * asked for. Without a name, a plan of one module (main included) means that module.
 */
async function planModule(project: string, command: string, wanted: string | undefined) {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const { mode } = manifest;
  if (mode === "remix") throw new VeridError("VERID_BURNT_MODE_MISMATCH", { command, mode });
  const file = planFile(project);
  const state = readState(statePaths(project));
  if (
    state.station &&
    ["order", "serve"].includes(command) &&
    wanted !== undefined &&
    wanted !== state.station.module
  )
    throw new VeridError("VERID_BURNT_STATION_INVALID", {
      detail: `this station owns ${state.station.module}`,
    });
  const plan = readPlan(
    project,
    manifest.iterations !== undefined,
    planned(manifest),
    servedSections(state),
  );
  if (plan === null) throw new VeridError("VERID_BURNT_PLAN_MISSING", { path: file });
  if (!plan.ok)
    throw new VeridError("VERID_BURNT_PLAN_INVALID", { path: file, detail: plan.detail });
  const names = plan.modules.map((m) => m.name);
  const name = wanted ?? (names.length === 1 ? names[0] : undefined);
  if (name === undefined)
    throw new VeridError("VERID_BURNT_MODULE_REQUIRED", { modules: names.join(", ") });
  const module = plan.modules.find((m) => m.name === name);
  if (!module)
    throw new VeridError("VERID_BURNT_MODULE_UNKNOWN", { module: name, modules: names.join(", ") });
  return { mode, plan, name, module, manifest };
}

/**
 * A person at a real terminal: never in a pipe or CI, where a prompt would wait forever, nor in a
 * dumb terminal, which cannot redraw a list.
 */
const hasTerminal = () =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isCi(process.env.CI);
const interactive = () => hasTerminal() && process.env.TERM !== "dumb";

/** The developer's terminal; colour unless NO_COLOR is set to something (no-color.org). */
const terminalIo = (): Io => ({
  input: process.stdin,
  output: process.stdout,
  color: !process.env.NO_COLOR,
  interrupts: process,
});

const locale = () => Intl.DateTimeFormat().resolvedOptions().locale;
const systemLang = (): Lang => (locale().toLowerCase().startsWith("vi") ? "vi" : "en");

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // missing or broken: it registers nothing
  }
}
