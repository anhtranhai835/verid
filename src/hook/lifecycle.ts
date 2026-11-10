import { type Cycle, cycleLabel } from "../core/tdd.js";
import { type State } from "../core/state.js";
import { type Manifest, planned } from "../core/manifest.js";
import { taskSessionProblem } from "../core/kanban.js";
import {
  readFileHash,
  type StatePaths,
  withLock,
  readState,
  writeState,
} from "../adapters/state-store.js";
import { join } from "node:path";
import { readPlan, servedSections, autoFactsOf } from "../adapters/plan-file.js";
import { type AutoFacts, autoPhase, closeReady, securityOf } from "../core/auto.js";
import { captureWork } from "../adapters/git.js";
import { appendAudit } from "../adapters/audit-log.js";
import { auditWarnings } from "../adapters/rule-audit.js";

export const statusLine = (mode: string, cycle: Cycle, lastRun: string | null) =>
  `verid: TDD ${cycleLabel(cycle)} · mode ${mode} · last run ${lastRun ?? "none"}`;

export function kanbanSessionProblem(
  project: string,
  state: State,
  session: string,
  manifest: Manifest,
): string | null {
  const problem = taskSessionProblem(
    state.kanban,
    session,
    readFileHash(join(project, ".verid/spec.md")),
  );
  if (problem) return problem;
  const name = state.kanban.active!.module;
  const plan = readPlan(
    project,
    manifest.iterations !== undefined,
    planned(manifest),
    servedSections(state),
  );
  const approval = state.modules[name];
  if (
    !plan?.ok ||
    !approval ||
    approval.sha256 !== plan.hashes[name] ||
    approval.design_sha256 !== readFileHash(join(project, ".verid/design.md"))
  )
    return "Plan hoặc design đã thay đổi. Người dùng cần duyệt lại task trên verid board rồi mở session mới.";
  return null;
}

/** Record Git bases for audit only; no branch writes or integration waits. */
export function advance(
  project: string,
  paths: StatePaths,
  state: State,
  facts: AutoFacts,
  manifest: Manifest,
): State {
  const phase = autoPhase({ ...facts, auto: state.auto, approvals: state.modules });
  if (phase.kind !== "module" || state.auto.work?.module === phase.view.name) return state;
  const captured = captureWork(project, manifest);
  if ("detail" in captured)
    appendAudit(paths.audit, {
      event: "warning",
      code: "GIT_WORK_BASE",
      target: captured.repo,
      reason: captured.detail,
    });
  const roots = "detail" in captured ? {} : captured;
  const work = { module: phase.view.name, roots };
  appendAudit(paths.audit, { event: "work_started", module: phase.view.name });
  return { ...state, auto: { ...state.auto, work } };
}

/** Observe an auto module without changing Git or holding an advisory warning. */
export function observe(project: string, paths: StatePaths, manifest: Manifest): void {
  withLock(paths, () => {
    const state = readState(paths);
    if (state.auto.signed === null) return;
    const facts = autoFactsOf(project, state, manifest.iterations !== undefined, planned(manifest));
    const moved = advance(project, paths, state, facts, manifest);
    if (moved !== state) writeState(paths, moved);
  });
}

/** Passing evidence and current reviews close a module independently of convention audits. */
export function tryClose(
  project: string,
  paths: StatePaths,
  state: State,
  facts: AutoFacts,
  manifest: Manifest,
  observed?: string[],
): State {
  const phase = autoPhase(facts);
  if (
    phase.kind !== "module" ||
    !facts.plan?.ok ||
    !closeReady(phase.view, state.tdd, state.review, securityOf(state, manifest.roles))
  )
    return state;
  const view = phase.view;
  const now = new Date().toISOString();
  appendAudit(paths.audit, {
    event: "module_served",
    module: view.name,
    by: "auto",
    warnings: observed ?? auditWarnings(project, manifest, state),
  });
  return {
    ...state,
    modules: {
      ...state.modules,
      [view.name]: {
        sha256: facts.plan.hashes[view.name]!,
        acs: view.acs,
        at: now,
        served_at: now,
        design_sha256: facts.designHash,
      },
    },
    review: null,
    security: null,
    auto: {
      ...state.auto,
      module_reviews: 0,
      security_reviews: 0,
      coder_rounds: {},
      stop_holds: 0,
      progress: null,
      work: null,
    },
  };
}
