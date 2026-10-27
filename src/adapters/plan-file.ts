import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  autoModules,
  autoNextStep,
  autoPhase,
  LIMIT,
  securityOf,
  type AutoFacts,
} from "../core/auto.js";
import type { Drive, Iterations, Manifest, Mode, Roles } from "../core/manifest.js";
import { iterationDates } from "../core/iterations.js";
import {
  modulePhases,
  nextStep,
  openModule,
  openQuestions,
  parsePlan,
  type Evidence,
  type ModuleView,
  type PlanModule,
} from "../core/plan.js";
import { mappedAgents } from "../core/roles.js";
import type { State } from "../core/state.js";
import { cycleHint, cycleLabel } from "../core/tdd.js";
import { gitTree } from "./git.js";
import { bilingual } from "./i18n.js";
import { errno } from "./state-store.js";

export const planFile = (project: string): string => join(project, ".verid", "plan.md");
export const researchFile = (project: string): string => join(project, ".verid", "research.md");
export const designFile = (project: string): string => join(project, ".verid", "design.md");
/** Where an auto drive's agents write why they cannot go on. */
export const blockedFile = (project: string): string => join(project, ".verid", "blocked.md");

/** prep and recipe start from what the project is, written in `.verid/research.md`. */
export const researchMissing = (project: string, mode: Mode): boolean =>
  mode !== "remix" && !existsSync(researchFile(project));

/** Then how it is built, in `.verid/design.md`, before any plan. */
export const designMissing = (project: string, mode: Mode): boolean =>
  mode !== "remix" && !existsSync(designFile(project));

/** sha256 of a file as saved, BOM and line endings included; null when it is missing. */
export function readFileHash(file: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw e;
  }
}

/** sha256 of `.verid/design.md` as saved; null when missing. */
export const readDesignHash = (project: string): string | null => readFileHash(designFile(project));

/** What the modules' phases are judged on: the last run's passing ACs, and the design now. */
export const evidenceOf = (project: string, state: State): Evidence => ({
  passedAcs: state.tdd.passed_acs,
  passedE2eAcs: state.tdd.passed_e2e_acs,
  designHash: readDesignHash(project),
});

export type PlanRead =
  | { ok: true; modules: PlanModule[]; hashes: Record<string, string> }
  | { ok: false; detail: string };

/**
 * The plan's modules and the sha256 of each module's section, null when there is no plan. Each
 * section is hashed on its own, so editing one module leaves the others' approvals standing. The
 * implicit main's section is the whole file, so its hash is the file's, as 0.1.0-beta.1 recorded.
 * Any other failure propagates: a plan that cannot be read must not look like one that is
 * missing, or the gate would misjudge it.
 */
export function readPlan(project: string, iterations = false): PlanRead | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(planFile(project));
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw e;
  }
  const plan = parsePlan(bytes.toString("utf8"), iterations);
  if (!plan.ok) return plan;
  const hashes = Object.fromEntries(
    plan.modules.map((m) => [m.name, createHash("sha256").update(m.text, "utf8").digest("hex")]),
  );
  return { ok: true, modules: plan.modules, hashes };
}

/**
 * What an auto drive decides from: the three files as saved, the plan as `readPlan` reads it, the
 * developer-approved modules and the last run's passing ACs from state, and the trimmed text of
 * `.verid/blocked.md` (null when missing or blank). Reads only; any read error but a missing file
 * propagates, so a file that cannot be read never looks like one that was not written.
 */
export function autoFactsOf(project: string, state: State, iterations = false): AutoFacts {
  let blocked: string;
  try {
    blocked = readFileSync(blockedFile(project), "utf8").trim();
  } catch (e) {
    if (errno(e) !== "ENOENT") throw e;
    blocked = "";
  }
  return {
    auto: state.auto,
    researchHash: readFileHash(researchFile(project)),
    designHash: readDesignHash(project),
    planHash: readFileHash(planFile(project)),
    plan: readPlan(project, iterations),
    approvals: state.modules,
    evidence: { passedAcs: state.tdd.passed_acs, passedE2eAcs: state.tdd.passed_e2e_acs },
    blockedFile: blocked === "" ? null : blocked,
  };
}

/**
 * The questions still open in `.verid/plan.md`, then `.verid/research.md`, one line each as
 * `  ? plan.md:4 which locale?`. A missing file has none; any other read error propagates.
 */
export function questionLines(project: string): string[] {
  return [planFile(project), researchFile(project)].flatMap((file) => {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      if (errno(e) === "ENOENT") return [];
      throw e;
    }
    return openQuestions(text).map((q) => `  ? ${basename(file)}:${q.line} ${q.text}`.trimEnd());
  });
}

/**
 * `verid peek`, also `/verid:peek` in Claude Code: the cycle and what it allows, the gate off
 * when there is no manifest, and in remix whether the baseline is recorded. In prep and recipe
 * the next step is the menu's, and the cycle shows only once a module is open: until then the
 * plan locks production code whatever the cycle says. An auto drive's next step is its own.
 */
export function peekLines(
  project: string,
  mode: Mode | null,
  state: State,
  roles: Roles | undefined,
  drive?: Drive,
  manifest?: Manifest,
  singleWriter = manifest?.providers?.length === 1 && manifest.providers[0] === "codex",
): string[] {
  if (mode === null)
    return ["verid: TDD off · no .verid/manifest.yaml", bilingual("status.off", {})];
  const { tdd, baseline } = state;
  // remix keeps its known failures in the baseline, which `verid taste` needs before it runs.
  const remix = mode === "remix";
  const size = remix && baseline ? ` · baseline ${baseline.length}` : "";
  const head = `verid: TDD ${cycleLabel(tdd)} · mode ${mode} · last run ${tdd.last_run ?? "none"}${size}`;
  const hint = bilingual(cycleHint(tdd), {});
  if (remix)
    return [head, hint, ...(baseline === null ? [bilingual("status.no_baseline", {})] : [])];
  if (drive === "auto") {
    const { phase, step } = autoStanding(project, state, roles, manifest, singleWriter);
    return [head, ...(phase.kind === "module" ? [hint] : []), step, bilingual("status.menu", {})];
  }
  const plan = planStanding(project, state, manifest?.iterations !== undefined);
  const open = plan.ok && openModule(plan.views) !== undefined;
  return [
    head,
    ...(open ? [hint] : []),
    stepLine(plan, roles, singleWriter),
    bilingual("status.menu", {}),
  ];
}

/** The plan as `verid menu` reads it: the modules' phases, the open questions, the next step. */
function planStanding(project: string, state: State, iterations = false) {
  const questions = questionLines(project);
  const plan = readPlan(project, iterations) ?? { ok: true as const, modules: [], hashes: {} };
  if (!plan.ok) return { ok: false as const, questions, detail: plan.detail };
  const hasResearch = existsSync(researchFile(project));
  const hasDesign = existsSync(designFile(project));
  const views = modulePhases(plan.modules, plan.hashes, state.modules, evidenceOf(project, state));
  const step = nextStep(hasResearch, hasDesign, views, questions.length > 0);
  return {
    ok: true as const,
    questions,
    hasResearch,
    hasDesign,
    modules: plan.modules,
    views,
    step,
  };
}

// A step that hands work to an agent names the one mapped to the role, or — when none is.
const stepLine = (
  plan: ReturnType<typeof planStanding>,
  roles: Roles | undefined,
  singleWriter = false,
): string =>
  plan.ok
    ? bilingual(plan.step.key, {
        ...mappedAgents(roles, singleWriter),
        ...("module" in plan.step ? { module: plan.step.module } : {}),
      })
    : bilingual("menu.invalid", { detail: plan.detail });

/**
 * An auto drive as `verid menu` reads it: the facts it decides from, where it stands, and the one
 * next step. git is asked only once a module is open, where it tells whether the work is committed.
 */
function autoStanding(
  project: string,
  state: State,
  roles: Roles | undefined,
  manifest?: Manifest,
  singleWriter = false,
) {
  const facts = autoFactsOf(project, state, manifest?.iterations !== undefined);
  const phase = autoPhase(facts);
  const clean =
    phase.kind === "module" ? gitTree(project, manifest, state.auto.signed).clean : null;
  const next = autoNextStep(
    phase,
    facts.researchHash !== null,
    facts.designHash !== null,
    state.review,
    clean,
    securityOf(state, roles),
  );
  const step = bilingual(next.key, { ...mappedAgents(roles, singleWriter), ...next.params });
  return { facts, phase, step };
}

const moduleCount = (views: readonly ModuleView[]) =>
  `${views.length} module${views.length === 1 ? "" : "s"}`;

const moduleLine = (v: ModuleView) =>
  `  ${v.name} · ${v.phase} · ${v.acs.length - v.uncovered.length}/${v.acs.length} ACs${v.designChanged ? " · design changed since order" : ""}`;

/** Calendar status only: it never feeds a gate or an auto-drive decision. */
function iterationLines(
  iterations: Iterations | undefined,
  modules: readonly PlanModule[],
  views: readonly ModuleView[],
  today?: string,
): string[] {
  if (!iterations) return [];
  // The boundary supplies today's local calendar date; core only sees literal dates.
  if (today === undefined) {
    const now = new Date();
    today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  const dates = iterationDates(iterations, today);
  const served = new Set(views.filter((v) => v.phase === "done").map((v) => v.name));
  const current = modules.filter((m) => m.iteration === dates.number);
  return [
    bilingual("menu.iteration", {
      number: String(dates.number),
      start: dates.start,
      end: dates.end,
      demo: iterations.demo_day,
      days: String(dates.daysToDemo),
      detail_key:
        dates.daysToDemo < 0
          ? "menu.iteration_demo_passed"
          : dates.daysToDemo === 0
            ? "menu.iteration_demo_today"
            : dates.daysToDemo === 1
              ? "menu.iteration_demo_day"
              : "menu.iteration_demo_days",
      served: String(current.filter((m) => served.has(m.name)).length),
      total: String(current.length),
    }),
    ...modules
      .filter((m) => m.iteration !== undefined && m.iteration < dates.number && !served.has(m.name))
      .map((m) =>
        bilingual("menu.iteration_late", { module: m.name, number: String(m.iteration) }),
      ),
  ];
}

/**
 * `verid menu`, also shown at session start: where the project stands and the one next step.
 * prep and recipe list each module with its phase and AC coverage, and the open questions;
 * remix has no plan, only the baseline the developer records first. An auto drive lists the same
 * modules, in the order it builds them, with how far each of its loops has gone.
 */
export function menuLines(
  project: string,
  mode: Mode,
  state: State,
  roles: Roles | undefined,
  drive?: Drive,
  manifest?: Manifest,
  today?: string,
  singleWriter = manifest?.providers?.length === 1 && manifest.providers[0] === "codex",
): string[] {
  if (mode === "remix") {
    const baseline = state.baseline === null ? "none" : String(state.baseline.length);
    return [
      `verid: mode remix · baseline ${baseline}`,
      bilingual("menu.remix", {}),
      ...(state.baseline === null ? [bilingual("status.no_baseline", {})] : []),
    ];
  }
  if (drive === "auto")
    return autoMenuLines(project, mode, state, roles, manifest, today, singleWriter);
  const plan = planStanding(project, state, manifest?.iterations !== undefined);
  if (!plan.ok)
    return [
      `verid: mode ${mode} · plan invalid`,
      ...iterationLines(manifest?.iterations, [], [], today),
      ...plan.questions,
      stepLine(plan, roles, singleWriter),
    ];
  const { views } = plan;
  const research = ` · research ${plan.hasResearch ? "written" : "missing"}`;
  const design = ` · design ${plan.hasDesign ? "written" : "missing"}`;
  return [
    `verid: mode ${mode}${research}${design} · ${moduleCount(views)}`,
    ...iterationLines(manifest?.iterations, plan.modules, views, today),
    ...views.map(moduleLine),
    ...plan.questions,
    stepLine(plan, roles, singleWriter),
  ];
}

function autoMenuLines(
  project: string,
  mode: Mode,
  state: State,
  roles: Roles | undefined,
  manifest?: Manifest,
  today?: string,
  singleWriter = false,
): string[] {
  const { facts, phase, step } = autoStanding(project, state, roles, manifest, singleWriter);
  const { auto, plan } = facts;
  // A plan that cannot be read lists no modules; the step says what to fix. A module is built only
  // while the drive is at it: unsigned, planning or stuck, the one next in line waits.
  const views = plan?.ok
    ? autoModules(plan.modules, plan.hashes, facts.approvals, facts.evidence).map((v) =>
        phase.kind !== "module" && v.phase !== "done" ? { ...v, phase: "planned" as const } : v,
      )
    : [];
  const reviewed = auto.plan_sha256 !== null && auto.plan_sha256 === facts.planHash;
  const rounds = Object.entries(auto.coder_rounds)
    .filter(([, n]) => n > 0)
    .map(([ac, n]) => `${ac} ${n}/${LIMIT}`);
  const counters = [
    ...(rounds.length > 0 ? [`rounds ${rounds.join(", ")}`] : []),
    `module reviews ${auto.module_reviews}/${LIMIT}`,
    ...(roles?.security ? [`security reviews ${auto.security_reviews}/${LIMIT}`] : []),
    `plan reviews ${auto.plan_reviews}/${LIMIT}`,
    `stops ${auto.stop_holds}/${LIMIT}`,
  ];
  return [
    `verid: mode ${mode} · drive auto · ${auto.signed === null ? "not signed" : "signed"} · plan ${reviewed ? "reviewed" : "pending"} · ${moduleCount(views)}`,
    ...iterationLines(manifest?.iterations, plan?.ok ? plan.modules : [], views, today),
    ...views.map(moduleLine),
    ...(auto.signed === null ? [] : [`  ${counters.join(" · ")}`]),
    ...questionLines(project),
    step,
  ];
}
