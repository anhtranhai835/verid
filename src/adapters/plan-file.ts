import { planned } from "../core/manifest.js";
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
import { architectureProblems, type ArchitectureProblem } from "../core/architecture.js";
import type { Drive, Iterations, Manifest, Mode, Roles } from "../core/manifest.js";
import { singleWriterOnly } from "../core/manifest.js";
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
import { checkedRepos } from "./architecture.js";
import { type Work } from "./git.js";
import { bilingual } from "./i18n.js";
import { auditLines } from "./rule-audit.js";
import { errno, readFileHash } from "./state-store.js";
import { checkSetupPath } from "./workspace.js";
import { effectiveOrder } from "../core/kanban.js";

export const MODULE_INPUTS = [
  "ba/requirements.md",
  "ui/brief.md",
  "spec/spec.md",
  "spec/design.md",
  "tests/test-plan.md",
  "security/threat-model.md",
] as const;

export const planFile = (project: string): string => join(project, ".verid", "plan.md");
export const researchFile = (project: string): string => join(project, ".verid", "research.md");
export const specFile = (project: string): string => join(project, ".verid", "spec.md");
export const designFile = (project: string): string => join(project, ".verid", "design.md");
/** Where an auto drive's agents write why they cannot go on. */
export const blockedFile = (project: string): string => join(project, ".verid", "blocked.md");

/** prep and recipe start from what the project is, written in `.verid/research.md`. */
export const researchMissing = (project: string, mode: Mode): boolean =>
  mode !== "remix" && !existsSync(researchFile(project));

/** Then what it must do, as traceable requirements in `.verid/spec.md`. */
export const specMissing = (project: string, mode: Mode): boolean =>
  mode !== "remix" && !existsSync(specFile(project));

/** Then how it is built, in `.verid/design.md`, before any plan. */
export const designMissing = (project: string, mode: Mode): boolean =>
  mode !== "remix" && !existsSync(designFile(project));

/** sha256 of `.verid/design.md` as saved; null when missing. */
export const readDesignHash = (project: string): string | null => readFileHash(designFile(project));

/** What the modules' phases are judged on: the last run's passing ACs, and the design now. */
export const evidenceOf = (project: string, state: State): Evidence => ({
  passedAcs: state.tdd.passed_acs,
  passedE2eAcs: state.tdd.passed_e2e_acs,
  designHash: readDesignHash(project),
});

/** Where each module stands: the plan's sections against the approvals and the last run. */
export const planViews = (
  project: string,
  plan: { modules: readonly PlanModule[]; hashes: Readonly<Record<string, string>> },
  state: State,
  approvals: State["modules"] = state.modules,
): ModuleView[] =>
  modulePhases(
    orderedModules(plan.modules, state),
    plan.hashes,
    approvals,
    evidenceOf(project, state),
  );

export const servedModules = (state: State): Set<string> =>
  new Set(
    Object.entries(state.modules)
      .filter(([, approval]) => approval.served_at !== null)
      .map(([name]) => name),
  );
export const servedSections = (state: State): Map<string, string> =>
  new Map(
    Object.entries(state.modules)
      .filter(([, approval]) => approval.served_at !== null)
      .map(([name, approval]) => [name, approval.sha256]),
  );

/** Shared by menu, the board and AI drive; priority never changes a plan signature. */
export function orderedModules<T extends { name: string }>(
  modules: readonly T[],
  state: State,
): T[] {
  const building =
    state.kanban.active?.module ??
    state.auto.work?.module ??
    Object.entries(state.modules).find(([, approval]) => approval.served_at === null)?.[0] ??
    null;
  const order = effectiveOrder(state.kanban.queue, modules, servedModules(state), building);
  return order.map((name) => modules.find((module) => module.name === name)!);
}

/** Dossier diagnostics also work on drafts so the board can explain how to make them ready. */
export function dossierStatus(project: string, module: Pick<PlanModule, "name" | "text">) {
  const base = `.verid/artifacts/03-modules/${module.name}`;
  const missing: string[] = [];
  let unresolved = 0;
  let problem: string | null = null;
  const references = [...module.text.matchAll(/^Artifacts:[ \t]*(.*?)[ \t]*\r?$/gm)];
  if (references.length !== 1 || references[0]?.[1] !== base)
    problem = `${module.name}: requires Artifacts: ${base}`;
  for (const input of MODULE_INPUTS) {
    const rel = `${base}/${input}`;
    checkSetupPath(project, rel);
    try {
      const text = readFileSync(join(project, rel), "utf8");
      if (!text.trim()) missing.push(rel);
      const count = [...text.matchAll(/\[NEEDS CLARIFICATION/g)].length;
      unresolved += count;
      if (count && problem === null) problem = `${rel}: resolve the module draft before order`;
    } catch (error) {
      if (errno(error) !== "ENOENT") throw error;
      missing.push(rel);
    }
  }
  if (problem === null && missing.length)
    problem = `${missing[0]}: missing module input; run verid module ${module.name}`;
  return { missing, unresolved, problem };
}

/**
 * A dossier made with `verid module --quick` or `--fix` keeps the same gates but holds one AC; a
 * fix also names its root cause before order.
 */
function pathProblem(project: string, base: string, module: PlanModule): string | null {
  const text = readFileSync(join(project, base, "ba/requirements.md"), "utf8");
  const path = /^Path:[ \t]*(quick|fix)[ \t]*\r?$/m.exec(text)?.[1];
  if (path === undefined) return null;
  if (module.acs.length !== 1)
    return `${module.name}: a ${path} module has one AC, this one has ${module.acs.length}; split it, or make it a full module: delete ${base}, then run verid module ${module.name}`;
  const cause = /^##[ \t]*Root cause[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(text);
  if (path === "fix" && !cause?.[1]?.trim())
    return `${base}/ba/requirements.md: write the Root cause, found with the debugging skill, before order`;
  return null;
}

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
export function readPlan(
  project: string,
  iterations = false,
  modular = false,
  served: ReadonlySet<string> | ReadonlyMap<string, string> = new Set(),
  drafts = false,
): PlanRead | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(planFile(project));
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw e;
  }
  const plan = parsePlan(bytes.toString("utf8"), iterations);
  if (!plan.ok) return plan;
  const hashes: Record<string, string> = {};
  for (const module of plan.modules) {
    const hash = createHash("sha256").update(module.text, "utf8");
    const references = [...module.text.matchAll(/^Artifacts:[ \t]*(.*?)[ \t]*\r?$/gm)];
    if (references.length > 1)
      return { ok: false, detail: `${module.name}: use one Artifacts line` };
    const reference = references[0]?.[1];
    const legacyServed =
      served.has(module.name) &&
      (!("get" in served) ||
        served.get(module.name) === createHash("sha256").update(module.text, "utf8").digest("hex"));
    if (modular && reference === undefined && !legacyServed && !drafts)
      return {
        ok: false,
        detail: `${module.name}: requires Artifacts: .verid/artifacts/03-modules/${module.name}`,
      };
    if (reference !== undefined) {
      const expected = `.verid/artifacts/03-modules/${module.name}`;
      if (reference !== expected)
        return { ok: false, detail: `${module.name}: Artifacts must be ${expected}` };
      for (const input of MODULE_INPUTS) {
        const rel = `${expected}/${input}`;
        checkSetupPath(project, rel);
        let content: Buffer;
        try {
          content = readFileSync(join(project, rel));
        } catch (error) {
          if (errno(error) === "ENOENT" && drafts) continue;
          if (errno(error) === "ENOENT")
            return {
              ok: false,
              detail: `${rel}: missing module input; run verid module ${module.name}`,
            };
          throw error;
        }
        if (
          !drafts &&
          (!content.toString("utf8").trim() || content.includes("[NEEDS CLARIFICATION"))
        )
          return { ok: false, detail: `${rel}: resolve the module draft before order` };
        hash.update("\0").update(input).update("\0").update(content);
      }
      const problem = drafts ? null : pathProblem(project, expected, module);
      if (problem) return { ok: false, detail: problem };
      const choice = `${expected}/ui/mockups/choice.json`;
      checkSetupPath(project, choice);
      try {
        const content = readFileSync(join(project, choice));
        hash.update("\0ui/mockups/choice.json\0").update(content);
      } catch (error) {
        if (errno(error) !== "ENOENT") throw error;
      }
    }
    hashes[module.name] = hash.digest("hex");
  }
  return { ok: true, modules: plan.modules, hashes };
}

/**
 * The open module and where its work began: the auto drive's recorded work and branch, or the
 * human order's. Null when no module is open; work undefined when none was recorded for it.
 */
export function openWork(
  project: string,
  manifest: Pick<Manifest, "drive" | "iterations" | "mode">,
  state: State,
): { module: string; work: Work | undefined; branch?: string } | null {
  const iterations = manifest.iterations !== undefined;
  if (manifest.drive === "auto") {
    const phase = autoPhase(autoFactsOf(project, state, iterations, planned(manifest)));
    if (phase.kind !== "module") return null;
    const { name } = phase.view;
    const work = state.auto.work?.module === name ? state.auto.work : undefined;
    return { module: name, work: work?.roots, ...(work?.branch && { branch: work.branch }) };
  }
  const plan = readPlan(project, iterations, planned(manifest), servedSections(state));
  const views = plan?.ok ? planViews(project, plan, state) : [];
  const name = openModule(views)?.name;
  return name === undefined ? null : { module: name, work: state.modules[name]?.work };
}

/**
 * What an auto drive decides from: the three files as saved, the plan as `readPlan` reads it, the
 * developer-approved modules and the last run's passing ACs from state, and the trimmed text of
 * `.verid/blocked.md` (null when missing or blank). Reads only; any read error but a missing file
 * propagates, so a file that cannot be read never looks like one that was not written.
 */
export function autoFactsOf(
  project: string,
  state: State,
  iterations = false,
  modular = false,
): AutoFacts {
  let blocked: string;
  try {
    blocked = readFileSync(blockedFile(project), "utf8").trim();
  } catch (e) {
    if (errno(e) !== "ENOENT") throw e;
    blocked = "";
  }
  const plan = readPlan(project, iterations, modular, servedSections(state));
  const planHash = readFileHash(planFile(project));
  const inputHash =
    plan?.ok && plan.modules.some((module) => /^Artifacts:/m.test(module.text))
      ? createHash("sha256")
          .update(JSON.stringify([planHash, plan.hashes]))
          .digest("hex")
      : planHash;
  const orderedPlan =
    plan?.ok &&
    plan.modules.some((module) => module.name === "product") &&
    plan.modules.at(-1)?.name !== "product"
      ? { ok: false as const, detail: "the product module must come last" }
      : plan?.ok
        ? { ...plan, modules: orderedModules(plan.modules, state) }
        : plan;
  return {
    auto: state.auto,
    researchHash: readFileHash(researchFile(project)),
    specHash: readFileHash(specFile(project)),
    designHash: readDesignHash(project),
    planHash: inputHash,
    plan: orderedPlan,
    approvals: state.modules,
    evidence: { passedAcs: state.tdd.passed_acs, passedE2eAcs: state.tdd.passed_e2e_acs },
    blockedFile: blocked === "" ? null : blocked,
  };
}

/** Last checker results, advisory only; no filesystem snapshot or module signature is required. */
export function architectureOf(manifest: Manifest, state: State): ArchitectureProblem[] {
  return architectureProblems(
    checkedRepos(manifest).map(({ repo }) => ({ repo: repo.path })),
    state.architecture,
  );
}

/** An architecture problem as `verid menu` and the Stop holds say it. */
export const architectureLine = (p: ArchitectureProblem): string =>
  bilingual(p.code, { repo: p.repo, detail: p.detail, log: p.log });

/**
 * The questions still open in `.verid/plan.md`, `.verid/spec.md`, then `.verid/research.md`, one line each as
 * `  ? plan.md:4 which locale?`. A missing file has none; any other read error propagates.
 */
export function questionLines(project: string): string[] {
  return [planFile(project), specFile(project), researchFile(project)].flatMap((file) => {
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
  singleWriter = singleWriterOnly(manifest?.providers),
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
  const plan = planStanding(
    project,
    state,
    manifest?.iterations !== undefined,
    manifest ? planned(manifest) : false,
  );
  const open = plan.ok && openModule(plan.views) !== undefined;
  return [
    head,
    ...(open ? [hint] : []),
    ...architectureLines(manifest, state, plan),
    stepLine(plan, roles, singleWriter),
    bilingual("status.menu", {}),
  ];
}

/** Each configured repo whose check must run (again) before the module under evaluation closes. */
const architectureLines = (
  manifest: Manifest | undefined,
  state: State,
  plan: ReturnType<typeof planStanding>,
): string[] =>
  manifest && plan.ok && openModule(plan.views)?.phase === "evaluating"
    ? architectureOf(manifest, state).map(architectureLine)
    : [];

/** The plan as `verid menu` reads it: the modules' phases, the open questions, the next step. */
function planStanding(project: string, state: State, iterations = false, modular = false) {
  const questions = questionLines(project);
  const strict = readPlan(project, iterations, modular, servedSections(state));
  const detail = strict && !strict.ok ? strict.detail : null;
  const plan = (detail
    ? readPlan(project, iterations, false, servedSections(state), true)
    : strict) ?? {
    ok: true as const,
    detail,
    modules: [],
    hashes: {},
  };
  if (!plan.ok) return { ok: false as const, questions, detail: plan.detail };
  const hasResearch = existsSync(researchFile(project));
  const hasSpec = existsSync(specFile(project));
  const hasDesign = existsSync(designFile(project));
  const views = planViews(project, plan, state);
  const step = nextStep(hasResearch, hasDesign, views, questions.length > 0, hasSpec);
  return {
    ok: true as const,
    detail,
    questions,
    hasResearch,
    hasSpec,
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
    ? plan.detail
      ? bilingual("menu.invalid", { detail: plan.detail })
      : bilingual(plan.step.key, {
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
  const facts = autoFactsOf(
    project,
    state,
    manifest?.iterations !== undefined,
    manifest ? planned(manifest) : false,
  );
  const phase = autoPhase(facts);
  const next = autoNextStep(
    phase,
    facts.researchHash !== null,
    facts.designHash !== null,
    state.review,
    securityOf(state, roles),
    facts.specHash !== null,
    state.auto.module_reviews,
  );
  const step = bilingual(next.key, { ...mappedAgents(roles, singleWriter), ...next.params });
  return { facts, phase, step };
}

const moduleCount = (views: readonly ModuleView[]) =>
  `${views.length} module${views.length === 1 ? "" : "s"}`;

/** The modules a view depends on that the plan has and that are not served yet. */
export const unservedDependencies = (v: ModuleView, views: readonly ModuleView[]): string[] =>
  (v.depends ?? []).filter((dep) => views.some((o) => o.name === dep && o.phase !== "done"));

const moduleLine = (v: ModuleView, views: readonly ModuleView[]) => {
  const waiting = v.phase === "planned" ? unservedDependencies(v, views) : [];
  return `  ${v.name} · ${v.phase} · ${v.acs.length - v.uncovered.length}/${v.acs.length} ACs${v.designChanged ? " · design changed since order" : ""}${waiting.length > 0 ? ` · waits for ${waiting.join(", ")}` : ""}`;
};

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
  singleWriter = singleWriterOnly(manifest?.providers),
): string[] {
  if (mode === "remix") {
    const baseline = state.baseline === null ? "none" : String(state.baseline.length);
    return [
      `verid: mode remix · baseline ${baseline}`,
      bilingual("menu.remix", {}),
      ...(manifest ? auditLines(project, manifest, state, false) : []),
      ...(state.baseline === null ? [bilingual("status.no_baseline", {})] : []),
    ];
  }
  if (drive === "auto")
    return autoMenuLines(project, mode, state, roles, manifest, today, singleWriter);
  const plan = planStanding(
    project,
    state,
    manifest?.iterations !== undefined,
    manifest ? planned(manifest) : false,
  );
  if (!plan.ok)
    return [
      `verid: mode ${mode} · plan invalid`,
      ...iterationLines(manifest?.iterations, [], [], today),
      ...plan.questions,
      stepLine(plan, roles, singleWriter),
    ];
  const { views } = plan;
  const research = ` · research ${plan.hasResearch ? "written" : "missing"}`;
  const spec = ` · spec ${plan.hasSpec ? "written" : "missing"}`;
  const design = ` · design ${plan.hasDesign ? "written" : "missing"}`;
  return [
    `verid: mode ${mode}${research}${spec}${design} · ${moduleCount(views)}`,
    ...iterationLines(manifest?.iterations, plan.modules, views, today),
    ...views.map((v) => moduleLine(v, views)),
    ...plan.questions,
    ...(manifest ? auditLines(project, manifest, state, false) : []),
    ...architectureLines(manifest, state, plan),
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
  const displayPlan = plan?.ok
    ? plan
    : readPlan(project, manifest?.iterations !== undefined, false, servedSections(state), true);
  // A plan that cannot be read lists no modules; the step says what to fix. A module is built only
  // while the drive is at it: unsigned, planning or stuck, the one next in line waits.
  const views = displayPlan?.ok
    ? autoModules(
        orderedModules(displayPlan.modules, state),
        displayPlan.hashes,
        facts.approvals,
        facts.evidence,
      ).map((v) =>
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
    `verid: mode ${mode} · drive no-brain · ${auto.signed === null ? "not signed" : "signed"} · plan ${reviewed ? "reviewed" : "pending"} · ${moduleCount(views)}`,
    ...iterationLines(
      manifest?.iterations,
      displayPlan?.ok ? displayPlan.modules : [],
      views,
      today,
    ),
    ...views.map((v) => moduleLine(v, views)),
    ...(auto.signed === null ? [] : [`  ${counters.join(" · ")}`]),
    ...questionLines(project),
    ...(manifest ? auditLines(project, manifest, state, false) : []),
    step,
  ];
}
