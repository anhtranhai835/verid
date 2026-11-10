import type * as z from "zod/mini";
import { lifecycleSchema } from "../adapters/claude-code.js";
import * as shared from "./shared.js";
import { type Result } from "../adapters/host.js";
import { loadManifest } from "../adapters/manifest.js";
import {
  statePaths,
  withLock,
  readState,
  writeState,
  type StatePaths,
  writeReview,
} from "../adapters/state-store.js";
import { reviewSnapshot } from "../adapters/review-snapshot.js";
import { appendAudit } from "../adapters/audit-log.js";
import { taskSessions, planned, type Manifest } from "../core/manifest.js";
import { kanbanSessionProblem, observe, statusLine, advance, tryClose } from "./lifecycle.js";
import { subagentHold } from "../core/roles.js";
import { bilingual } from "../adapters/i18n.js";
import { type State } from "../core/state.js";
import { autoPhase, coderRoundsAfter, parseVerdict } from "../core/auto.js";
import { autoFactsOf } from "../adapters/plan-file.js";
import { keyId } from "../core/tdd.js";
import { createHash } from "node:crypto";
import { relative, join } from "node:path";

/**
 * Hold writers once for evidence, except reviewers; an auto coder's allowed stop ends a round.
 */
const reviewJobKey = (p: z.infer<typeof lifecycleSchema>): string =>
  JSON.stringify([shared.host().id, p.session_id, p.agent_id]);

export async function subagentStart(p: z.infer<typeof lifecycleSchema>): Promise<Result> {
  if (!p.agent_id) return { exit: 0 };
  const project = shared.projectDir(p.cwd);
  const manifest = await loadManifest(project);
  if (!manifest) return { exit: 0 };
  const kind = shared.writerFor(p.agent_id, p.agent_type, manifest.roles);
  if (kind !== "reviewer" && kind !== "security") return { exit: 0 };
  const paths = statePaths(project);
  withLock(paths, () => {
    const state = readState(paths);
    const key = reviewJobKey(p);
    // Repeated lifecycle delivery must never refresh an already-running review.
    if (Object.hasOwn(state.review_jobs, key)) return;
    const snapshot = reviewSnapshot(project, manifest, state, kind);
    if (!snapshot) return;
    appendAudit(paths.audit, { event: "review_started", agent_id: p.agent_id, ...snapshot });
    writeState(paths, { ...state, review_jobs: { ...state.review_jobs, [key]: snapshot } });
  });
  return { exit: 0 };
}

export async function subagentStop(p: z.infer<typeof lifecycleSchema>): Promise<Result> {
  const project = shared.projectDir(p.cwd);
  const manifest = await loadManifest(project);
  if (!manifest) return { exit: 0 };
  const paths = statePaths(project);
  if (taskSessions(manifest)) {
    const problem = kanbanSessionProblem(
      project,
      readState(paths),
      shared.sessionKey(p.session_id),
      manifest,
    );
    if (problem) {
      withLock(paths, () =>
        appendAudit(paths.audit, {
          event: "task_subagent_ignored",
          session: p.session_id,
          reason: problem,
        }),
      );
      return { exit: 0 };
    }
  }
  const writer = shared.writerFor(p.agent_id, p.agent_type, manifest.roles);
  const auto = manifest.drive === "auto";
  if (writer === "reviewer" || writer === "security") {
    if (manifest.mode !== "remix") recordReview(p, project, paths, auto, manifest, writer);
    return { exit: 0 };
  }
  const agentId = p.agent_id;
  if (agentId === undefined) return { exit: 0 };
  if (auto) observe(project, paths, manifest);
  return withLock(paths, () => {
    const state = readState(paths);
    // An agent that wrote nothing is never held, but its stop still ends the coder's round.
    const wrote = state.writers.includes(agentId);
    const why =
      wrote && !p.stop_hook_active
        ? subagentHold(writer, shared.splitFor(manifest.roles), state.tdd)
        : null;
    if (why) {
      appendAudit(paths.audit, {
        event: "subagent_stop_blocked",
        session: p.session_id,
        agent_id: agentId,
        agent_type: p.agent_type,
      });
      const line = statusLine(manifest.mode, state.tdd, state.tdd.last_run);
      return { exit: 2, stderr: `${line}\n${bilingual(why, {})}\n` };
    }
    const rounds =
      auto && writer === "coder"
        ? coderRounds(
            project,
            paths,
            state,
            p,
            manifest.iterations !== undefined,
            planned(manifest),
          )
        : null;
    if (!wrote && rounds === null) return { exit: 0 };
    writeState(paths, {
      ...state,
      writers: state.writers.filter((a) => a !== agentId),
      ...(rounds && { auto: { ...state.auto, coder_rounds: rounds } }),
    });
    return { exit: 0 };
  });
}

/** Audit per-AC coder rounds for the active module; caller writes under the lock. */
function coderRounds(
  project: string,
  paths: StatePaths,
  state: State,
  p: z.infer<typeof lifecycleSchema>,
  iterations: boolean,
  modular = false,
): Record<string, number> | null {
  if (autoPhase(autoFactsOf(project, state, iterations, modular)).kind !== "module") return null;
  const { failing, crashed, passed_acs } = state.tdd;
  const before = state.auto.coder_rounds;
  const after = coderRoundsAfter(before, [...failing.map(keyId), ...crashed], passed_acs);
  const acs = Object.entries(after)
    .filter(([ac, n]) => n > (before[ac] ?? 0))
    .map(([ac]) => ac);
  if (acs.length > 0)
    appendAudit(paths.audit, { event: "coder_round", session: p.session_id, acs });
  return after;
}

/**
 * Save mapped reviewers' reports under .state. Human drives review the open module;
 * auto drives review the plan first, then modules. Security never reviews plans; remix has none.
 */
function recordReview(
  p: z.infer<typeof lifecycleSchema>,
  project: string,
  paths: StatePaths,
  auto: boolean,
  manifest: Manifest,
  kind: "reviewer" | "security",
): void {
  const report = p.last_assistant_message ?? "";
  const sha256 = createHash("sha256").update(report, "utf8").digest("hex");
  const verdict = parseVerdict(report);
  withLock(paths, () => {
    let read = readState(paths);
    const key = reviewJobKey(p);
    const started = read.review_jobs[key];
    const current = reviewSnapshot(project, manifest, read, kind);
    const { [key]: completed, ...remaining } = read.review_jobs;
    read = { ...read, review_jobs: remaining };
    if (
      !started ||
      !current ||
      started.kind !== kind ||
      started.subject !== current.subject ||
      started.identity !== current.identity
    ) {
      appendAudit(paths.audit, {
        event: "warning",
        code: "REVIEW_STALE",
        target: started?.subject ?? p.agent_type ?? kind,
        reason: "Review inputs changed or SubagentStart is missing; dispatch a fresh reviewer.",
      });
      writeState(paths, read);
      return;
    }
    const identity = started.identity;
    const known = auto
      ? autoFactsOf(project, read, manifest.iterations !== undefined, planned(manifest))
      : null;
    // Capture audit bases before recording a module review.
    const advanced =
      known && autoPhase(known).kind === "module"
        ? advance(project, paths, read, known, manifest)
        : null;
    const state = advanced ?? read;
    const facts = known && { ...known, auto: state.auto };
    const phase = facts === null ? null : autoPhase(facts);
    const module =
      phase === null
        ? shared.openModuleName(project, state, manifest)
        : phase.kind === "module"
          ? phase.view.name
          : undefined;
    const at = new Date().toISOString();
    const saved = (subject: string) => {
      const name = `${subject}-${at.replace(/[:.]/g, "-")}.md`;
      return { name, file: relative(project, join(paths.reviews, name)) };
    };
    const who = { session: p.session_id, agent_type: p.agent_type, agent_id: p.agent_id };
    // Audit first, then the report, then state: a failure on the way leaves the old review.
    if (kind === "reviewer" && phase?.kind === "plan") {
      const { name, file } = saved("plan");
      // A plan auto cannot run does not pass, whatever the reviewer says.
      const passed = verdict === "pass" && !phase.missing && phase.problem === null;
      const hash = passed ? (facts?.planHash ?? null) : null;
      appendAudit(paths.audit, { event: "plan_reviewed", ...who, sha256, verdict, file });
      writeReview(paths, name, report);
      const { auto: now } = state;
      // A module review read the plan as it was: once a changed plan passes, it needs another.
      const reviewed: State = {
        ...state,
        ...(hash === null
          ? { auto: { ...now, plan_reviews: now.plan_reviews + 1 } }
          : {
              auto: { ...now, plan_sha256: hash, plan_reviews: 0 },
              review: null,
              security: null,
            }),
      };
      // A passing plan opens the first module.
      const opened = { ...facts!, auto: reviewed.auto };
      writeState(paths, advance(project, paths, reviewed, opened, manifest));
      return;
    }
    // With no module to review, keep the observed audit state.
    if (!module) {
      const moved = facts && !advanced ? advance(project, paths, state, facts, manifest) : state;
      if (JSON.stringify(moved) !== JSON.stringify(read)) writeState(paths, moved);
      return;
    }
    const security = kind === "security";
    const { name, file } = saved(security ? `security-${module}` : module);
    const event = security ? "security_recorded" : "review_recorded";
    appendAudit(paths.audit, { event, ...who, module, sha256, verdict, file });
    writeReview(paths, name, report);
    const recorded = {
      module,
      agent_type: p.agent_type ?? "",
      file,
      sha256,
      at,
      verdict,
      identity,
    };
    const failures = security ? "security_reviews" : "module_reviews";
    const next: State = {
      ...state,
      ...(security ? { security: recorded } : { review: recorded }),
      ...(auto &&
        verdict !== "pass" && {
          auto: { ...state.auto, [failures]: state.auto[failures] + 1 },
        }),
    };
    if (!facts) return writeState(paths, next);
    // A passing review can serve the module now and open the next.
    const closed = tryClose(project, paths, next, { ...facts, auto: next.auto }, manifest);
    const after = { ...facts, auto: closed.auto, approvals: closed.modules };
    writeState(paths, closed === next ? next : advance(project, paths, closed, after, manifest));
  });
}
