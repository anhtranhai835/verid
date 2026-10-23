#!/usr/bin/env node
import type { ErrorCode, MessageKey } from "../core/errors.js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { autoNextStep, autoPhase, changedServed } from "../core/auto.js";
import type { Manifest } from "../core/manifest.js";
import {
  modulePhases,
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
import { guardsToolCalls } from "../adapters/claude-settings.js";
import { bilingual, setLanguage, t, veridName, type Lang } from "../adapters/i18n.js";
import { loadManifest, manifestFile } from "../adapters/manifest.js";
import { appendAudit } from "../adapters/audit-log.js";
import { gitView } from "../adapters/git.js";
import {
  autoFactsOf,
  blockedFile,
  designFile,
  evidenceOf,
  menuLines,
  peekLines,
  planFile,
  questionLines,
  readDesignHash,
  readPlan,
  researchFile,
} from "../adapters/plan-file.js";
import {
  languageOf,
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import type { Io } from "../adapters/terminal.js";
import { interactiveCook } from "./cook-screen.js";
import { initCommand } from "./init.js";
import { baselineCommand, lastRefusal, testCommand, type CliResult } from "./test.js";

/** verid CLI. Exit 2 means verid refused or failed, and nothing counted as evidence. */
async function main(): Promise<void> {
  const project = findProject(process.cwd());
  const [cmd, ...rest] = process.argv.slice(2);
  setLanguage(languageOf(project));
  let r: CliResult;
  try {
    const flags = cmd === "cook" ? initFlags(rest) : null;
    if (flags?.lang === "vi" || flags?.lang === "en") setLanguage(flags.lang);
    // cook sets up the folder it runs in, like `git init`; the others look upwards for .verid.
    // In the developer's own terminal, with no flags, it asks instead of reading flags.
    if (cmd === "cook" && rest.length === 0 && interactive())
      r = await interactiveCook(process.cwd(), terminalIo(), locale());
    else if (flags) r = await initCommand(process.cwd(), flags);
    else if (cmd === "taste" && rest.length === 0) r = await testCommand(project);
    else if (cmd === "peek" && rest.length === 0) r = await status(project);
    else if (cmd === "menu" && rest.length === 0) r = await menu(project);
    else if (cmd === "garnish" && rest.length === 0) r = refactor(project);
    else if (cmd === "stock" && rest.length === 0) r = await baselineCommand(project);
    else if (cmd === "order" && rest.length <= 1) r = await approve(project, rest[0]);
    else if (cmd === "serve" && rest.length === 1) r = await serve(project, rest[0] as string);
    else if (cmd === undefined || ["help", "--help", "-h"].includes(cmd)) r = usage(project, null);
    else r = usage(project, misused(cmd, rest));
  } catch (err) {
    const code: ErrorCode = err instanceof VeridError ? err.code : "VERID_BURNT_INTERNAL";
    const params =
      err instanceof VeridError
        ? err.params
        : { detail: err instanceof Error ? err.message : String(err) };
    r = { exit: 2, stdout: "", stderr: `verid [${code}]\n${bilingual(code, params)}\n` };
  }
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.exit;
}

const COOK_OPTIONS = {
  mode: { type: "string" },
  drive: { type: "string" },
  lang: { type: "string" },
  "test-cmd": { type: "string" },
  src: { type: "string", multiple: true },
  tests: { type: "string", multiple: true },
} as const;

/** `--mode`, `--drive`, `--test-cmd`, `--src` and `--tests` (repeatable); null when anything else is passed. */
function initFlags(args: string[]) {
  try {
    const { values } = parseArgs({ args, options: COOK_OPTIONS });
    return {
      mode: values.mode,
      drive: values.drive,
      lang: values.lang,
      testCmd: values["test-cmd"],
      src: values.src ?? [],
      tests: values.tests ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Claude Code sets CLAUDE_PROJECT_DIR for hooks but not for Bash commands, and the agent may
 * have cd'ed into a subdirectory, so look upwards for .verid the way git looks for .git.
 */
function findProject(cwd: string): string {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".verid"))) return dir;
    if (dirname(dir) === dir) return cwd;
  }
}

async function status(project: string): Promise<CliResult> {
  const state = readState(statePaths(project));
  // A teammate who cloned the project but never ran cook has state and manifest, and no hooks.
  const hook = fileURLToPath(new URL("./hook.js", import.meta.url));
  const guarded = ["settings.local.json", "settings.json"].some((f) =>
    guardsToolCalls(readJson(join(project, ".claude", f)), hook),
  );
  const stderr = guarded ? "" : `${bilingual("status.no_hooks", {})}\n`;
  // The gate follows the manifest, not state: say so when it is off (an invalid one throws).
  const manifest = await loadManifest(project);
  const lines = peekLines(project, manifest?.mode ?? null, state, manifest?.roles, manifest?.drive);
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
  taste: 0,
  peek: 0,
  menu: 0,
  garnish: 0,
  stock: 0,
  order: 1,
  serve: 1,
};

/** What verid could not run in a command line: the command, or the words it did not expect. */
function misused(cmd: string, rest: string[]): Misuse {
  if (cmd === "cook") {
    const { tokens } = parseArgs({
      args: rest,
      options: COOK_OPTIONS,
      strict: false,
      tokens: true,
    });
    const odd = tokens.flatMap((tk) =>
      tk.kind === "positional"
        ? [tk.value]
        : tk.kind === "option" && !(tk.name in COOK_OPTIONS)
          ? [tk.rawName]
          : [],
    );
    return {
      key: "usage.unexpected",
      params: { command: cmd, args: (odd.length > 0 ? odd : rest).join(" ") },
    };
  }
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
function usage(project: string, wrong: Misuse | null): CliResult {
  const lang: Lang = languageOf(project) ?? (locale().toLowerCase().startsWith("vi") ? "vi" : "en");
  const say = (key: MessageKey) => t(lang, key, {});
  const v = veridName();
  const dev = say("usage.developer");
  // Outside a real terminal, cook asks nothing and needs the mode: never point to what fails.
  const cook = interactive() ? `${v} cook` : `${v} cook --mode <prep|recipe|remix>`;
  const rows: UsageRow[] = [
    { emoji: "🔪", command: cook, what: say("usage.cook"), who: dev },
    { emoji: "👅", command: `${v} taste`, what: say("usage.taste") },
    { emoji: "👀", command: `${v} peek`, what: say("usage.peek") },
    { emoji: "📋", command: `${v} menu`, what: say("usage.menu") },
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
  ];
  const tty = wrong ? process.stderr.isTTY : process.stdout.isTTY;
  const color = Boolean(tty) && !process.env.NO_COLOR;
  const lines = usageLines(say("usage.tagline"), rows, say("usage.in_claude"), color);
  if (!wrong) return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  const text = [t(lang, wrong.key, wrong.params), ...lines].join("\n");
  return { exit: 2, stdout: "", stderr: `${text}\n` };
}

/** `verid menu`: the plan's modules, where each one stands, and the one next step. */
async function menu(project: string): Promise<CliResult> {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const state = readState(statePaths(project));
  return {
    exit: 0,
    stdout: `${menuLines(project, manifest.mode, state, manifest.roles, manifest.drive).join("\n")}\n`,
    stderr: "",
  };
}

/**
 * `verid garnish`: the developer declares that this conversation only refactors. A new
 * conversation starts in RAW (hook.ts), which would lock production code for a pure refactor;
 * only the developer may open it, and only while every test passed in the last run.
 */
function refactor(project: string): CliResult {
  if (process.env.CLAUDECODE === "1") throw new VeridError("VERID_BURNT_REFACTOR_IN_AGENT");
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
 * `verid order [module]` (prep and recipe, developer only): record one module of
 * `.verid/plan.md` as the part the tests have to cover now. The approval holds for the module's
 * section as it is, and only one module is open at a time. The file is read once, so the hash and
 * the AC list describe the same bytes.
 */
async function approve(project: string, wanted: string | undefined): Promise<CliResult> {
  if (process.env.CLAUDECODE === "1") throw new VeridError("VERID_BURNT_APPROVE_IN_AGENT");
  const manifest = await loadManifest(project);
  if (manifest?.drive === "auto") return signAuto(project, manifest, wanted);
  const { plan, name, module } = await planModule(project, "order", wanted);
  const problem = moduleProblem(module);
  if (problem)
    throw new VeridError("VERID_BURNT_PLAN_INVALID", { path: planFile(project), detail: problem });
  // The order signs how the project is built too: changing the design reopens the question.
  const design = readDesignHash(project);
  if (design === null)
    throw new VeridError("VERID_BURNT_DESIGN_MISSING", { path: designFile(project) });

  const sha256 = plan.hashes[name] as string;
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const views = modulePhases(
      plan.modules,
      plan.hashes,
      state.modules,
      evidenceOf(project, state),
    );
    const open = openModule(views);
    // The product module says the whole product works, so every other module is done first.
    const waiting = views.filter((v) => v.name !== PRODUCT && v.phase !== "done");
    if (name === PRODUCT && waiting.length > 0)
      throw new VeridError("VERID_BURNT_PRODUCT_TOO_EARLY", {
        modules: waiting.map((v) => v.name).join(", "),
      });
    if (open && open.name !== name)
      throw new VeridError("VERID_BURNT_MODULE_OPEN", { module: open.name });
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
      ([other, a]) => other !== name && a.served_at !== null,
    );
    writeState(paths, {
      ...state,
      modules: {
        ...Object.fromEntries(served),
        [name]: {
          sha256,
          acs: module.acs,
          at: new Date().toISOString(),
          served_at: null,
          design_sha256: design,
        },
      },
      ac_stop_session: null,
      review: null,
    });
    const acs = module.acs.join(", ");
    const count = module.acs.length;
    return {
      exit: 0,
      stdout: `verid: module ${name} approved · ${count} acceptance ${count === 1 ? "criterion" : "criteria"}\n${bilingual("approve.done", { module: name, acs })}\n`,
      stderr: "",
    };
  });
}

/**
 * `verid order` in an auto drive (developer only): sign the research and the design as they are
 * now, which starts the drive, and continue one that was stuck. The drive opens and serves the
 * modules itself, so a module name is refused. Signing starts every loop over and drops the review
 * of the open module; the reviewed plan stands only if neither file changed since the last
 * signature. A served module whose section of the plan was edited since is reopened, and one the
 * plan no longer has is forgotten. Each file is read once, so the hashes signed and the next step
 * describe the same bytes.
 */
function signAuto(project: string, manifest: Manifest, wanted: string | undefined): CliResult {
  if (wanted !== undefined) throw new VeridError("VERID_BURNT_AUTO_ORDER_MODULE");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const facts = autoFactsOf(project, state);
    const { researchHash, designHash } = facts;
    if (researchHash === null)
      throw new VeridError("VERID_BURNT_RESEARCH_MISSING", { path: researchFile(project) });
    if (designHash === null)
      throw new VeridError("VERID_BURNT_DESIGN_MISSING", { path: designFile(project) });

    const before = state.auto.signed;
    const unchanged =
      before?.research_sha256 === researchHash && before.design_sha256 === designHash;
    const edited = facts.plan?.ok ? changedServed(facts.plan.hashes, state.modules) : [];
    const next: State = {
      ...state,
      modules: Object.fromEntries(
        Object.entries(state.modules).filter(([m]) => !edited.includes(m)),
      ),
      review: null,
      auto: {
        ...FRESH_AUTO,
        signed: {
          research_sha256: researchHash,
          design_sha256: designHash,
          at: new Date().toISOString(),
          git: gitView(project) !== null,
        },
        plan_sha256: unchanged ? state.auto.plan_sha256 : null,
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
    const step = autoNextStep(phase, true, true, null, null);
    // Audit first: if it fails, state is untouched and nothing was signed.
    appendAudit(paths.audit, {
      event: "auto_signed",
      research_sha256: researchHash,
      design_sha256: designHash,
    });
    writeState(paths, next);
    rmSync(blockedFile(project), { force: true });
    const lines = [
      `verid: auto signed · research ${researchHash.slice(0, 8)} · design ${designHash.slice(0, 8)}`,
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
async function serve(project: string, wanted: string): Promise<CliResult> {
  if (process.env.CLAUDECODE === "1") throw new VeridError("VERID_BURNT_SERVE_IN_AGENT");
  // Before the plan is read: auto refuses even where there is no plan yet.
  if ((await loadManifest(project))?.drive === "auto")
    throw new VeridError("VERID_BURNT_AUTO_SERVE");
  const { mode, plan, name, manifest } = await planModule(project, "serve", wanted);
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const views = modulePhases(
      plan.modules,
      plan.hashes,
      state.modules,
      evidenceOf(project, state),
    );
    const view = views.find((v) => v.name === name) as ModuleView;
    // The reason is a message of its own, so it comes in the developer's language.
    const reviewers = (manifest.roles?.reviewer ?? []).join(", ");
    const notReady = (reason: MessageKey, acs = "") =>
      new VeridError("VERID_BURNT_SERVE_NOT_READY", {
        module: name,
        detail_key: reason,
        acs,
        reviewer: reviewers,
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

    const served = { ...(state.modules[name] as Approval), served_at: new Date().toISOString() };
    const next = { ...state, modules: { ...state.modules, [name]: served } };
    // The next step is worked out before anything is written, so a file that cannot be read
    // fails the command without serving half of it.
    const after = modulePhases(plan.modules, plan.hashes, next.modules, evidenceOf(project, state));
    const questions = questionLines(project);
    const step = nextStep(
      existsSync(researchFile(project)),
      existsSync(designFile(project)),
      after,
      questions.length > 0,
    );
    // Audit first: if it fails, state is untouched and the module stays open.
    appendAudit(paths.audit, { event: "module_served", module: name });
    writeState(paths, next);
    const lines = [
      `verid: module ${name} served`,
      bilingual("serve.done", { module: name }),
      bilingual("serve.review", { agent: review.agent_type, file: review.file }),
      ...questions,
      bilingual(step.key, "module" in step ? { module: step.module } : {}),
    ];
    return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  });
}

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
  const plan = readPlan(project);
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
const interactive = () =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY) &&
  !process.env.CI &&
  process.env.TERM !== "dumb";

/** The developer's terminal; colour unless NO_COLOR is set to something (no-color.org). */
const terminalIo = (): Io => ({
  input: process.stdin,
  output: process.stdout,
  color: !process.env.NO_COLOR,
  interrupts: process,
});

const locale = () => Intl.DateTimeFormat().resolvedOptions().locale;

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // missing or broken: it registers nothing
  }
}

await main();
