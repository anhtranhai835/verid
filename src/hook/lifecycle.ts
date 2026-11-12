import type * as z from "zod/mini";
import { userPromptSchema, lifecycleSchema } from "../adapters/claude-code.js";
import { type Result } from "../adapters/host.js";
import * as shared from "./shared.js";
import { parseVeridPrompt, handlePrompt } from "../core/override.js";
import {
  statePaths,
  readState,
  withLock,
  writeState,
  readFileHash,
  type StatePaths,
} from "../adapters/state-store.js";
import { loadManifest } from "../adapters/manifest.js";
import {
  researchMissing,
  menuLines,
  peekLines,
  readPlan,
  servedSections,
  planViews,
  autoFactsOf,
} from "../adapters/plan-file.js";
import { bilingual, veridName } from "../adapters/i18n.js";
import { appendAudit } from "../adapters/audit-log.js";
import { ERROR_CODES } from "../core/errors.js";
import { planned, taskSessions, type Roles, type Manifest } from "../core/manifest.js";
import { claimTaskSession, taskSessionProblem, type TaskProblem } from "../core/kanban.js";
import { type Cycle } from "../core/tdd.js";
import { openModule } from "../core/plan.js";
import { type State } from "../core/state.js";
import { join } from "node:path";
import {
  autoPhase,
  progressKey,
  stopHolds,
  LIMIT,
  autoNextStep,
  securityOf,
  type AutoPhase,
  type AutoFacts,
  closeReady,
} from "../core/auto.js";
import { auditWarnings, auditLines } from "../adapters/rule-audit.js";
import { captureWork } from "../adapters/git.js";
import { randomInt } from "node:crypto";
import { stationSessionProblem } from "../adapters/project.js";
import { scheduleStations } from "../adapters/station.js";

export async function userPrompt(p: z.infer<typeof userPromptSchema>): Promise<Result> {
  // A host with no attended-input signal (Codex) never opens an exception from a prompt, and
  // peek and menu stay in the terminal. Every prompt still gets the research reminder.
  const attended = shared.host().attended();
  const cmd = attended === null ? { kind: "none" as const } : parseVeridPrompt(p.prompt);
  const project = shared.projectDir(p.cwd);
  const paths = statePaths(project);
  if (cmd.kind === "none") {
    const halted = shared.haltedBy(paths);
    if (halted) return { exit: 0, stdout: shared.haltedLines(halted) };
    // Until research.md says what the project is, every prompt reminds the agent to ask first.
    const manifest = await loadManifest(project);
    if (!manifest || !researchMissing(project, manifest.mode)) return { exit: 0 };
    const reminder = [
      `verid: mode ${manifest.mode} · research missing`,
      bilingual("menu.research", {}),
    ];
    return { exit: 0, stdout: `${reminder.join("\n")}\n` };
  }
  if (cmd.kind === "peek" || cmd.kind === "menu") {
    // Shown as a blocked prompt: stderr reaches the developer only, and the agent spends no turn.
    const state = readState(paths);
    const manifest = await loadManifest(project);
    const lines =
      cmd.kind === "menu" && manifest
        ? menuLines(project, manifest.mode, state, manifest.roles, manifest.drive, manifest)
        : peekLines(
            project,
            manifest?.mode ?? null,
            state,
            manifest?.roles,
            manifest?.drive,
            manifest ?? undefined,
          );
    return { exit: 2, stderr: `${lines.join("\n")}\n` };
  }
  return withLock(paths, () => {
    const state = readState(paths);
    const r = handlePrompt(state, cmd, {
      session: p.session_id,
      attended: attended === true,
      agentId: p.agent_id,
      now: new Date().toISOString(),
      newCode: newCode(),
    });
    if (r.audit) appendAudit(paths.audit, r.audit);
    if (r.state !== state) writeState(paths, r.state);
    const o = r.outcome;
    if (o.kind === "pass") return { exit: 0 };
    // block: stderr reaches the developer only; context: stdout is added to the agent's context.
    // Only an error has a code to show; the risk warning is a message.
    const tag = (ERROR_CODES as readonly string[]).includes(o.key) ? `verid [${o.key}]\n` : "";
    return o.kind === "block"
      ? { exit: 2, stderr: `${tag}${bilingual(o.key, o.params)}\n` }
      : { exit: 0, stdout: `${bilingual(o.key, o.params)}\n` };
  });
}

export async function lifecycle(
  p: z.infer<typeof lifecycleSchema>,
  project: string,
  paths: StatePaths,
): Promise<Result> {
  const stationProblem = stationSessionProblem(
    project,
    shared.sessionKey(p.session_id),
    p.hook_event_name === "SessionStart" && p.source === "startup",
  );
  if (stationProblem) return shared.deny("VERID_BURNT_STATION_SESSION", { target: stationProblem });
  const { tdd } = readState(paths);
  const event = p.hook_event_name === "Stop" ? "stop" : "session_start";
  const manifest = await loadManifest(project);
  withLock(paths, () =>
    appendAudit(paths.audit, {
      event,
      session: p.session_id,
      ...(event === "session_start"
        ? {
            provider: shared.host().id,
            module: shared.usageModule(project, readState(paths), manifest ?? undefined),
          }
        : {}),
    }),
  );
  // Compaction drops the full reasons the agent saw: its next denial is printed in full again.
  if (event === "session_start" && p.source === "compact")
    withLock(paths, () => {
      const state = readState(paths);
      if (state.last_denied?.session === p.session_id)
        writeState(paths, { ...state, last_denied: null });
    });
  if (!manifest) return { exit: 0 };
  if (p.hook_event_name === "SessionStart" || p.hook_event_name === "Stop") {
    scheduleStations(project, manifest);
    const ownership = stationSessionProblem(project, shared.sessionKey(p.session_id), true);
    if (ownership) return shared.deny("VERID_BURNT_STATION_SESSION", { target: ownership });
  }
  let taskContext: string[] = [];
  if (planned(manifest))
    taskContext.push(
      "verid: module dossiers in .verid/artifacts/03-modules/<name> are required before order. Read .verid/workflow.md; use verid board for priorities.",
    );
  if (planned(manifest) && manifest.drive === "auto")
    taskContext.push(
      "verid: AI drive follows the developer's priority queue in one session. Finish the current task before moving to the next.",
    );
  if (taskSessions(manifest) || readState(paths).station !== null) {
    const key = shared.sessionKey(p.session_id);
    const kanban = withLock(paths, () => {
      const state = readState(paths);
      const kanban =
        p.hook_event_name === "SessionStart"
          ? claimTaskSession(state.kanban, key, p.source === "startup")
          : state.kanban;
      if (kanban !== state.kanban) writeState(paths, { ...state, kanban });
      return kanban;
    });
    const problem = kanbanSessionProblem(project, { ...readState(paths), kanban }, key, manifest);
    taskContext.push(
      problem
        ? bilingual(problem.key, { module: problem.module })
        : `verid: task ${kanban.active!.module}; ONE TASK PER SESSION. Run verid context ${kanban.active!.module} first; TDD → review → developer serve → STOP. Never start another task in this session.`,
    );
    if (p.hook_event_name === "Stop" && problem) return { exit: 0 };
  }
  const { mode } = manifest;
  const line = (cycle: Cycle) => shared.statusLine(mode, cycle, tdd.last_run);
  if (event === "stop") {
    const held = manifest.drive === "auto" ? autoStop(p, project, paths, manifest) : null;
    if (held) return held;
    // stop_hook_active marks the allowed retry after a human-drive hold.
    if (p.stop_hook_active) return { exit: 0 };
    // Failed, unloadable or unverified changes still need passing evidence.
    if (tdd.state === "COOKING" || tdd.stub || tdd.dirty) {
      const why =
        tdd.state === "COOKING" ? "stop.green" : tdd.stub ? "stop.stub" : "stop.unverified";
      const stderr = `${line(tdd)}\n${bilingual(why, {})}\n`;
      withLock(paths, () =>
        appendAudit(paths.audit, {
          event: "stop_blocked",
          session: p.session_id,
          module: shared.usageModule(project, readState(paths), manifest),
          chars: stderr.length,
        }),
      );
      return { exit: 2, stderr };
    }
    if (mode === "remix") return { exit: 0 };
    // Hold once per conversation for uncovered ACs or a missing evaluation.
    // State remembers the shared hold across later Stop events.
    return withLock(paths, () => {
      const state = readState(paths);
      const plan = readPlan(
        project,
        manifest.iterations !== undefined,
        planned(manifest),
        servedSections(state),
      );
      const views = plan?.ok ? planViews(project, plan, state) : [];
      const open = openModule(views);
      if (!open || state.ac_stop_session === p.session_id) return { exit: 0 };
      const cooking = open.phase === "cooking";
      const why = cooking
        ? bilingual("stop.uncovered", { acs: open.uncovered.join(", ") })
        : bilingual("stop.evaluate", { module: open.name, ...shared.mappedNames(manifest.roles) });
      const stderr = `${line(tdd)}\n${why}\n`;
      // Audit first: if it fails, state is untouched and the hold is not remembered.
      appendAudit(paths.audit, {
        event: "stop_blocked",
        session: p.session_id,
        reason: cooking ? "uncovered" : "evaluate",
        module: open.name,
        chars: stderr.length,
      });
      writeState(paths, { ...state, ac_stop_session: p.session_id });
      return { exit: 2, stderr };
    });
  }
  if (manifest.drive === "auto") observe(project, paths, manifest);
  // New conversations reopen PLATED; resumes and compaction keep the current cycle.
  let cycle: Cycle = tdd;
  if (
    !taskSessions(manifest) &&
    tdd.state === "PLATED" &&
    (p.source === "startup" || p.source === "clear")
  ) {
    const event = { session: p.session_id, tool: "SessionStart", target: p.source };
    shared.move(paths, event, { reopen: true, written: false });
    cycle = { state: "RAW", stub: false };
  }
  // SessionStart stdout goes into the agent's context: with the gate on, the agent learns the
  // cycle before its first write rather than from its first denial.
  const { roles } = manifest;
  const agents = shared.mappedNames(roles);
  const standing = menuLines(
    project,
    mode,
    readState(paths),
    roles,
    manifest.drive,
    manifest,
    undefined,
    shared.host().singleWriter,
  );
  // Session context stays an index, independent of module, question and audit counts.
  const next = standing.at(-1)!;
  const command = veridName();
  // The open module's log carries the last session's decisions into this one.
  const open = shared.loggedModule(project, manifest, readState(paths));
  const log = open ? [`verid: log .verid/log/${open}.md`, bilingual("session.log", {})] : [];
  if (p.source === "resume") {
    const alias = command !== "verid" && next.includes(command) ? `verid = ${command}\n` : "";
    const logged = log.map((text) => `${text}\n`).join("");
    return {
      exit: 0,
      stdout: `${line(cycle)}\n${alias}${taskContext.map((text) => `${text}\n`).join("")}${logged}${next.replaceAll(command, "verid")}\n`,
    };
  }
  return {
    exit: 0,
    stdout: [
      line(cycle),
      ...taskContext,
      ...(command === "verid" ? [] : [`verid = ${command}`]),
      // Resolve mapped agents now: only cook/upgrade refresh the block's role guide.
      // The mode walk-through belongs to session context.
      ...(roles && !shared.host().singleWriter
        ? [
            `verid: roles ${Object.entries(agents)
              .filter(
                ([role]) =>
                  roles[role as keyof Roles] || ["reviewer", "tester", "coder"].includes(role),
              )
              .map(([role, names]) => `${role} ${names}`)
              .join(" · ")}`,
          ]
        : []),
      bilingual(`mode.${mode}`, {}),
      ...(shared.host().singleWriter
        ? [
            bilingual(
              shared.host().id === "antigravity"
                ? "session.single_writer_antigravity"
                : "session.single_writer",
              { reviewer: agents.reviewer, security: agents.security },
            ),
          ]
        : []),
      ...(manifest.drive === "auto" ? [bilingual("drive.auto", {})] : []),
      standing[0]!,
      ...standing.filter((text) => /(?:^|\n)  iteration /.test(text)),
      bilingual("session.menu", {}),
      ...log,
      next,
      "",
    ]
      .map((text) => (text.startsWith("verid = ") ? text : text.replaceAll(command, "verid")))
      .join("\n"),
  };
}

export { statusLine } from "./shared.js";

export function kanbanSessionProblem(
  project: string,
  state: State,
  session: string,
  manifest: Manifest,
): TaskProblem | null {
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
    return { key: "task_session.plan_changed", module: name };
  return null;
}

/**
 * A signed auto drive closes ready modules and holds Stop until done or stuck.
 * Unsigned drives use human holds. Unchanged holds count toward LIMIT even with
 * stop_hook_active; waits do not count.
 */
function autoStop(
  p: z.infer<typeof lifecycleSchema>,
  project: string,
  paths: StatePaths,
  manifest: Manifest,
): Result | null {
  return withLock(paths, () => {
    let state = readState(paths);
    if (state.auto.signed === null) return null;
    let facts = autoFactsOf(
      project,
      state,
      manifest.iterations !== undefined,
      planned(manifest),
      manifest.stations,
    );
    const session = p.session_id;
    state = latchBlocked(paths, state, facts.blockedFile, session);
    state = advance(project, paths, state, { ...facts, auto: state.auto }, manifest);
    facts = { ...facts, auto: state.auto };
    const before = autoPhase(facts);
    const warnings = auditWarnings(project, manifest, state);
    const tried = tryClose(project, paths, state, facts, manifest, warnings);
    const closed = tried !== state && before.kind === "module" ? before.view.name : null;
    state = advance(
      project,
      paths,
      tried,
      { ...facts, auto: tried.auto, approvals: tried.modules },
      manifest,
    );
    facts = { ...facts, auto: state.auto, approvals: state.modules };
    let phase = autoPhase(facts);
    // A legacy unit that is ready except for the developer's signature on its parity record: the
    // drive waits for it and the agent may stop, as it does when stuck.
    const parityUnit =
      phase.kind === "module" &&
      facts.reheat?.unsigned.has(phase.view.name) &&
      closeReady(phase.view, state.tdd, state.review, securityOf(state, manifest.roles))
        ? phase.view.name
        : null;

    if (!over(phase) && parityUnit === null) {
      const served = Object.entries(state.modules)
        .filter(([, a]) => a.served_at !== null)
        .map(([m]) => m);
      const key = progressKey({
        tdd: state.tdd,
        planHash: facts.planHash,
        auto: state.auto,
        served,
        head: null,
      });
      state = { ...state, auto: { ...state.auto, ...stopHolds(state.auto, key) } };
      // Audit first, on either path: if it fails, state is untouched and the hold is not counted.
      if (state.auto.stop_holds >= LIMIT) {
        appendAudit(paths.audit, { event: "auto_stuck", session, reason: "no_progress" });
        phase = autoPhase({ ...facts, auto: state.auto });
      }
    }
    const step =
      parityUnit === null
        ? autoNextStep(
            phase,
            facts.researchHash !== null,
            facts.designHash !== null,
            state.review,
            securityOf(state, manifest.roles),
            facts.specHash !== null,
            state.auto.module_reviews,
          )
        : { key: "auto.reheat_parity" as const, params: { module: parityUnit } };
    const lines = [
      shared.statusLine(manifest.mode, state.tdd, state.tdd.last_run),
      ...auditLines(project, manifest, state, false, warnings),
      ...(closed === null ? [] : [bilingual("auto.closed", { module: closed })]),
      bilingual(step.key, { ...shared.mappedNames(manifest.roles), ...step.params }),
    ].join("\n");
    // The agent may stop, and the developer sees why.
    if (over(phase) || parityUnit !== null) {
      writeState(paths, state);
      return { exit: 0, stdout: JSON.stringify({ systemMessage: lines }) };
    }
    appendAudit(paths.audit, {
      event: "stop_blocked",
      session,
      reason: "auto",
      step: step.key,
      module: shared.usageModule(project, state, manifest),
      chars: lines.length + 1,
    });
    writeState(paths, state);
    return { exit: 2, stderr: `${lines}\n` };
  });
}

const over = (phase: AutoPhase): boolean => ["stuck", "done", "stations"].includes(phase.kind);

export const toLatch = (state: State, blocked: string | null): blocked is string =>
  blocked !== null && state.auto.signed !== null && state.auto.blocked === null;

/** Latch blocked.md until verid order resumes the drive; caller writes under the lock. */
export function latchBlocked(
  paths: StatePaths,
  state: State,
  blocked: string | null,
  session: string,
): State {
  if (!toLatch(state, blocked)) return state;
  appendAudit(paths.audit, { event: "auto_stuck", session, reason: "blocked" });
  return { ...state, auto: { ...state.auto, blocked } };
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
    const facts = autoFactsOf(
      project,
      state,
      manifest.iterations !== undefined,
      planned(manifest),
      manifest.stations,
    );
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
    !closeReady(phase.view, state.tdd, state.review, securityOf(state, manifest.roles)) ||
    // A legacy unit is served only after the developer signed its parity record.
    facts.reheat?.unsigned.has(phase.view.name)
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
        ...state.modules[view.name],
        sha256: facts.plan.hashes[view.name]!,
        acs: view.acs,
        at: now,
        served_at: now,
        design_sha256: facts.designHash,
      },
    },
    review: null,
    security: null,
    ...(state.station ? { kanban: { ...state.kanban, active: null } } : {}),
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

// No 0/O/1/I so the code is easy to read back and type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}
