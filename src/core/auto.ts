import type { ArchitectureProblem } from "./architecture.js";
import { canonicalJson } from "./canonical-json.js";
import type { ErrorCode, MessageKey } from "./errors.js";
import {
  acsInName,
  moduleProblem,
  openModule,
  PRODUCT,
  uncoveredAcs,
  type Approval,
  type Evidence,
  type ModuleView,
  type PlanModule,
} from "./plan.js";
import type { Roles } from "./manifest.js";
import type { AutoState, State } from "./state.js";

/** Every loop of an auto drive runs at most this many times before it is stuck. */
export const LIMIT = 3;

export type Verdict = "pass" | "fail";

// The verdict sits alone on its line, so prose that merely mentions one does not count; a bold
// label or value, a quote mark or a list dash around it does. `pass | fail`, the template's own
// line, matches neither.
const VERDICT = /^[ \t>*_-]*verdict[*_]*[ \t]*:[*_ \t]*(pass|fail)[*_ \t.]*$/gim;

/** The last `Verdict: pass|fail` line of a reviewer's report; fail when it has none. */
export function parseVerdict(report: string): Verdict {
  const last = [...report.replace(/\r/g, "").matchAll(VERDICT)].pop();
  return last?.[1]?.toLowerCase() === "pass" ? "pass" : "fail";
}

/** Why an auto drive cannot start building from this plan, or null when it can. */
export function autoPlanProblem(modules: readonly PlanModule[]): string | null {
  if (!modules.some((m) => m.name === PRODUCT)) return "the plan has no product module";
  if (modules[modules.length - 1]?.name !== PRODUCT) return "the product module must come last";
  for (const m of modules) {
    const problem = moduleProblem(m);
    if (problem !== null) return `${m.name}: ${problem}`;
  }
  return null;
}

/** When the module was served for the section the plan has now; null otherwise. */
const servedAt = (
  name: string,
  hashes: Readonly<Record<string, string>>,
  approvals: Readonly<Record<string, Approval>>,
): string | null => {
  const approval = approvals[name];
  return approval !== undefined && approval.sha256 === hashes[name] ? approval.served_at : null;
};

/**
 * Where each module stands when auto orders them itself: in plan order, the first one not served
 * is the one being built, and every module after it waits. The product module says the whole
 * product works, so it stands only when served last: a module served after it opens it again.
 * There is no design check here; auto stops on a design change before it looks at modules.
 */
export function autoModules(
  modules: readonly PlanModule[],
  hashes: Readonly<Record<string, string>>,
  approvals: Readonly<Record<string, Approval>>,
  evidence: Pick<Evidence, "passedAcs" | "passedE2eAcs">,
): ModuleView[] {
  const at = modules.map((m) => servedAt(m.name, hashes, approvals));
  const p = modules.findIndex((m) => m.name === PRODUCT);
  const productAt = at[p] ?? null;
  if (productAt !== null && at.some((t) => t !== null && t > productAt)) at[p] = null;
  const first = at.indexOf(null);
  return modules.map(({ name, acs, e2e }, i) => {
    const uncovered = uncoveredAcs(acs, e2e, evidence);
    const phase =
      i < first || first < 0
        ? "done"
        : i > first
          ? "planned"
          : uncovered.length > 0
            ? "cooking"
            : "evaluating";
    return {
      name,
      phase,
      acs,
      uncovered,
      designChanged: false,
      servedAt: phase === "done" ? (at[i] ?? null) : null,
    };
  });
}

/**
 * Served modules whose section differs from the one served: edited after the fact, or gone from
 * the plan (renamed or deleted), which has a hash for each module it holds.
 */
export function changedServed(
  hashes: Readonly<Record<string, string>>,
  approvals: Readonly<Record<string, Approval>>,
): string[] {
  return Object.entries(approvals)
    .filter(([name, a]) => a.served_at !== null && a.sha256 !== hashes[name])
    .map(([name]) => name);
}

export type StuckReason =
  | "blocked"
  | "research_changed"
  | "design_changed"
  | "served_changed"
  | "plan_reviews"
  | "coder_rounds"
  | "module_reviews"
  | "security_reviews"
  | "no_progress";

export type AutoPlanRead =
  | { ok: true; modules: PlanModule[]; hashes: Record<string, string> }
  | { ok: false; detail: string }
  | null; // no plan.md

/** Everything auto decides from, read by the caller: this file does no I/O. */
export interface AutoFacts {
  auto: AutoState;
  researchHash: string | null;
  designHash: string | null;
  /** sha256 of plan.md's bytes; null when it is missing. */
  planHash: string | null;
  plan: AutoPlanRead;
  approvals: Readonly<Record<string, Approval>>;
  evidence: Pick<Evidence, "passedAcs" | "passedE2eAcs">;
  /** Trimmed text of `.verid/blocked.md`; null when it is missing or empty. */
  blockedFile: string | null;
}

export type AutoPhase =
  | { kind: "unsigned" }
  | { kind: "stuck"; reason: StuckReason; detail: string }
  | { kind: "plan"; missing: boolean; problem: string | null }
  | { kind: "module"; view: ModuleView }
  | { kind: "done" };

type Stuck = Extract<AutoPhase, { kind: "stuck" }>;

/**
 * Why the drive cannot go on without the developer, the first that applies. Research or design
 * changing, or a served module edited, means the approved ground moved under the run; a counter
 * at LIMIT means a loop that did not converge.
 */
function stuck(f: AutoFacts, signed: NonNullable<AutoState["signed"]>): Stuck | null {
  const { auto } = f;
  const blocked = auto.blocked ?? f.blockedFile;
  if (blocked !== null) return { kind: "stuck", reason: "blocked", detail: blocked };
  if (signed.research_sha256 !== f.researchHash)
    return { kind: "stuck", reason: "research_changed", detail: ".verid/research.md" };
  if (signed.design_sha256 !== f.designHash)
    return { kind: "stuck", reason: "design_changed", detail: ".verid/design.md" };
  const edited = f.plan?.ok ? changedServed(f.plan.hashes, f.approvals) : [];
  if (edited[0] !== undefined)
    return { kind: "stuck", reason: "served_changed", detail: edited[0] };
  if (auto.plan_reviews >= LIMIT)
    return { kind: "stuck", reason: "plan_reviews", detail: String(auto.plan_reviews) };
  const ac = Object.entries(auto.coder_rounds).find(([, rounds]) => rounds >= LIMIT);
  if (ac !== undefined) return { kind: "stuck", reason: "coder_rounds", detail: ac[0] };
  if (auto.module_reviews >= LIMIT)
    return { kind: "stuck", reason: "module_reviews", detail: String(auto.module_reviews) };
  if (auto.security_reviews >= LIMIT)
    return { kind: "stuck", reason: "security_reviews", detail: String(auto.security_reviews) };
  if (auto.stop_holds >= LIMIT)
    return { kind: "stuck", reason: "no_progress", detail: String(auto.stop_holds) };
  return null;
}

/**
 * Where an auto drive stands, the first that applies: not signed by the developer; stuck; the
 * plan not yet written or passed by the reviewer (and unchanged since); a module to build; done.
 */
export function autoPhase(f: AutoFacts): AutoPhase {
  const { auto, plan } = f;
  if (auto.signed === null) return { kind: "unsigned" };
  const halt = stuck(f, auto.signed);
  if (halt !== null) return halt;
  if (plan === null) return { kind: "plan", missing: true, problem: null };
  if (!plan.ok) return { kind: "plan", missing: false, problem: plan.detail };
  const problem = autoPlanProblem(plan.modules);
  if (problem !== null || auto.plan_sha256 === null || auto.plan_sha256 !== f.planHash)
    return { kind: "plan", missing: false, problem };
  const view = openModule(autoModules(plan.modules, plan.hashes, f.approvals, f.evidence));
  return view === undefined ? { kind: "done" } : { kind: "module", view };
}

/**
 * The rounds each AC has had after a coder stopped: one a red test still names has had one more
 * round, however many red tests name it, even when another test of it passes; an AC that passes
 * with no red test left starts over. A new object, never the one given: state shares the
 * default, and a count written into it would leak into other projects.
 */
export function coderRoundsAfter(
  rounds: Readonly<Record<string, number>>,
  redTestIds: readonly string[],
  passedAcs: readonly string[],
): Record<string, number> {
  const red = new Set(redTestIds.flatMap(acsInName));
  const next = Object.fromEntries(
    Object.entries(rounds).filter(([ac]) => red.has(ac) || !passedAcs.includes(ac)),
  );
  for (const ac of red) next[ac] = (next[ac] ?? 0) + 1;
  return next;
}

/**
 * The clean-tree answer once signing has said whether the project uses git: a project signed inside
 * a repository does not lose the check by losing the repository, which counts as not clean. null
 * (no git to ask, skip the check) only for a project signed outside git.
 */
export function gitCleanOf(view: { clean: boolean } | null, signedInGit: boolean): boolean | null {
  return view !== null ? view.clean : signedInGit ? false : null;
}

/** Every repository keeps option-C semantics, including one removed from the manifest. */
export function gitCleanAcross(
  views: Readonly<Record<string, { clean: boolean } | null>>,
  signed: Readonly<Record<string, boolean>>,
): boolean | null {
  let result: boolean | null = null;
  for (const repo of new Set([...Object.keys(views), ...Object.keys(signed)])) {
    const clean = gitCleanOf(views[repo] ?? null, signed[repo] ?? false);
    if (clean === false) return false;
    if (clean === true) result = true;
  }
  return result;
}

/**
 * Whether verid closes the module itself: all its ACs have passing tests in a run that nothing has
 * changed since, the reviewer passed this module after its last change (any later write clears the
 * review), the security reviewer passed it too when one is mapped, every configured architecture
 * check passed on the files as they are, and the tree is committed. Where there is no git to ask,
 * that last check is skipped.
 */
export function closeReady(
  view: ModuleView,
  tdd: Pick<State["tdd"], "last_run" | "failing" | "dirty">,
  review: State["review"],
  gitClean: boolean | null,
  security?: State["security"],
  architecture: readonly ArchitectureProblem[] = [],
): boolean {
  return (
    view.phase === "evaluating" &&
    tdd.last_run !== null &&
    tdd.failing.length === 0 &&
    !tdd.dirty &&
    passed(review, view.name) &&
    (security === undefined || passed(security, view.name)) &&
    architecture.length === 0 &&
    gitClean !== false
  );
}

const passed = (report: State["review"], module: string): boolean =>
  report?.module === module && report.verdict === "pass";
const failed = (report: State["review"], module: string): boolean =>
  report?.module === module && report.verdict === "fail";

/**
 * The security report as the gates take it: undefined when no security reviewer is mapped, so
 * none is needed; null when one is mapped and has not reported yet.
 */
export const securityOf = (
  state: Pick<State, "security">,
  roles: Roles | undefined,
): State["security"] | undefined => (roles?.security ? state.security : undefined);

/**
 * What has progressed, as a string: equal while the outcome is. Time, order and the number of
 * holds are not outcomes, so they stay out; a counter is, because a failed round or review is a
 * change the drive can act on.
 */
export function progressKey(f: {
  tdd: Pick<State["tdd"], "state" | "stub" | "failing" | "passed_acs">;
  planHash: string | null;
  auto: AutoState;
  served: readonly string[];
  head: string | null;
}): string {
  const { tdd, auto } = f;
  return canonicalJson({
    state: tdd.state,
    stub: tdd.stub,
    failing: [...tdd.failing].sort(),
    passed: [...tdd.passed_acs].sort(),
    planHash: f.planHash,
    plan: auto.plan_sha256,
    served: [...f.served].sort(),
    head: f.head,
    plan_reviews: auto.plan_reviews,
    coder_rounds: auto.coder_rounds,
    module_reviews: auto.module_reviews,
    security_reviews: auto.security_reviews,
  });
}

/** The hold count after Stop held again: one more while the key is the last one, else from zero. */
export function stopHolds(auto: AutoState, key: string): { stop_holds: number; progress: string } {
  return { stop_holds: auto.progress === key ? auto.stop_holds + 1 : 0, progress: key };
}

/**
 * The one thing to do next. Role names ({tester}, {coder}, {reviewer}) are not params here: the
 * hook adds them where the project maps agents. An architecture check that has not passed on the
 * files as they are comes before the review, since fixing it voids a review.
 */
export function autoNextStep(
  phase: AutoPhase,
  hasResearch: boolean,
  hasDesign: boolean,
  review: State["review"],
  gitClean: boolean | null,
  security?: State["security"],
  architecture: readonly ArchitectureProblem[] = [],
): { key: MessageKey | ErrorCode; params: Record<string, string> } {
  switch (phase.kind) {
    case "unsigned":
      return {
        key: !hasResearch ? "menu.research" : !hasDesign ? "menu.design" : "auto.sign",
        params: {},
      };
    case "stuck":
      return { key: `auto.stuck.${phase.reason}`, params: { detail: phase.detail } };
    case "plan":
      if (phase.missing) return { key: "auto.plan", params: {} };
      return phase.problem === null
        ? { key: "auto.plan_review", params: {} }
        : { key: "auto.plan_fix", params: { detail: phase.problem } };
    case "module": {
      const { name, phase: at } = phase.view;
      // A failed review stands until the next write, which is the start of its fix.
      if (failed(review, name)) return { key: "auto.fix", params: { module: name } };
      if (security !== undefined && failed(security, name))
        return { key: "auto.security_fix", params: { module: name } };
      if (at === "cooking") return { key: "menu.cook", params: { module: name } };
      const [check] = architecture;
      if (check)
        return {
          key: check.code,
          params: { repo: check.repo, detail: check.detail, log: check.log },
        };
      if (!passed(review, name)) return { key: "auto.review", params: { module: name } };
      // The security reviewer reads the module once the reviewer has passed it.
      if (security !== undefined && !passed(security, name))
        return { key: "auto.security", params: { module: name } };
      return { key: gitClean === false ? "auto.commit" : "auto.review", params: { module: name } };
    }
    case "done":
      return { key: "auto.done", params: {} };
  }
}
