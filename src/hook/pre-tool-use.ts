import type * as z from "zod/mini";
import {
  preToolUseSchema,
  toAction,
  type FileAction,
  bashWrites,
  mcpFiles,
  normalizePath,
  writtenPath,
  policyContext,
  inputHash,
} from "../adapters/claude-code.js";
import { type Result } from "../adapters/host.js";
import * as shared from "./shared.js";
import {
  statePaths,
  withLock,
  VeridError,
  readState,
  writeState,
  type StatePaths,
} from "../adapters/state-store.js";
import { appendAudit } from "../adapters/audit-log.js";
import { loadManifest, tddLayouts } from "../adapters/manifest.js";
import { taskSessions, planned, type Roles } from "../core/manifest.js";
import { isUnder, decide } from "../core/policy.js";
import {
  fileRole,
  type AutoLock,
  decideTdd,
  type TddDecision,
  TDD_STRICTNESS,
} from "../core/tdd.js";
import { relative, dirname, resolve, isAbsolute } from "node:path";
import { kanbanSessionProblem, toLatch, latchBlocked } from "./lifecycle.js";
import { researchMissing, specMissing, designMissing, autoFactsOf } from "../adapters/plan-file.js";
import { type PolicyDecision, type RuleCode, isOverridable } from "../core/errors.js";
import { decideDispatch, decideAgentContext, decideKnownTool } from "../core/dispatch.js";
import { decideInstructions } from "../adapters/instruction-protection.js";
import { matchesGlob } from "../core/glob.js";
import { roleAdvice, type Writer, ROLE_DOCUMENTS } from "../core/roles.js";
import { consumeOverride, recordDenial } from "../core/override.js";
import { autoPhase } from "../core/auto.js";
import { withPluginDispatch } from "../adapters/plugin-store.js";
import { stationPolicy } from "../adapters/station-policy.js";
import { legacyPolicy } from "../adapters/legacy-policy.js";
import { stationContext, stationSessionProblem } from "../adapters/project.js";

export async function preToolUse(p: z.infer<typeof preToolUseSchema>): Promise<Result> {
  const project = shared.projectDir(p.cwd);
  const paths = statePaths(project);
  // The developer's kill switch comes before every rule, and no /verid tip lifts it.
  const halted = shared.haltedBy(paths);
  if (halted) {
    const result = shared.deny("VERID_BURNT_HALTED", { target: halted.reason });
    withLock(paths, () =>
      appendAudit(paths.audit, {
        event: "denied",
        session: p.session_id,
        tool: p.tool_name,
        rule: "VERID_BURNT_HALTED",
        target: halted.reason,
        module: shared.usageModule(project, readState(paths)),
        chars: shared.resultChars(result),
      }),
    );
    return result;
  }
  const adapted = shared.host().action(p);
  const action = adapted?.action ?? toAction(p);
  if ("invalid" in action) throw new VeridError("VERID_BURNT_PAYLOAD", { detail: action.invalid });
  // Include explicit Bash writes and file paths named by MCP calls.
  const files: FileAction[] =
    adapted?.files ?? (action.kind === "bash" ? bashWrites(action.command, p.cwd) : mcpFiles(p));
  const writes = [...(action.kind === "file" ? [action] : []), ...files].filter(
    (f) => f.access === "write",
  );
  // A broken manifest must still allow reads; existing write gates report its error in order.
  const taskManifest = await loadManifest(project, { readOnly: true }).catch(() => null);
  let taskProblem: string | null = null;
  if (taskManifest && (taskSessions(taskManifest) || stationContext(project)?.station)) {
    const key = shared.sessionKey(p.session_id);
    const layouts = tddLayouts(project, taskManifest);
    const guardedWrite = writes.some(
      (write) =>
        !isUnder(write.path, normalizePath(project)) ||
        (write.written !== undefined && !isUnder(write.written, writtenPath(project))) ||
        [
          ...layouts.real.map((layout) => ({ layout, path: write.path })),
          ...layouts.written.map((layout) => ({ layout, path: write.written ?? write.path })),
        ].some(
          ({ layout, path }) =>
            isUnder(path, layout.repoRoot) &&
            fileRole(relative(layout.repoRoot, path).replaceAll("\\", "/"), layout) !== "free",
        ),
    );
    const problem = withLock(paths, () => {
      const state = readState(paths);
      const used = state.kanban.sessions[key];
      // Planning may inspect the repo and write documents before a task is selected.
      if (!state.kanban.active && !used && !guardedWrite) return null;
      return kanbanSessionProblem(project, state, key, taskManifest);
    });
    taskProblem = problem;
  }
  const base = {
    ...policyContext(project, p.cwd),
    ...stationPolicy(project, p.cwd, writes),
    ...legacyPolicy(project, taskManifest, p.cwd),
  };
  const stationSession = stationSessionProblem(project, shared.sessionKey(p.session_id));
  // Any project write outside .verid/ invalidates security review, including linked paths.
  const roots = [normalizePath(project), writtenPath(project)];
  const verid = dirname(base.manifestPath);
  const voidsSecurity = writes.some(
    (w) =>
      roots.some(
        (root) => isUnder(w.path, root) || (w.written !== undefined && isUnder(w.written, root)),
      ) && !isUnder(w.path, verid),
  );
  // The manifest is read for a write to the plan only, so a broken one never blocks reads.
  const planManifest = writes.some((w) => w.path === base.planPath)
    ? await loadManifest(project)
    : null;
  const ctx = planManifest
    ? {
        ...base,
        researchMissing: researchMissing(project, planManifest.mode),
        specMissing: specMissing(project, planManifest.mode),
        designMissing: designMissing(project, planManifest.mode),
      }
    : base;
  // Defer TDD errors until policy rules have judged the call.
  const gate = await tddGate(p, project, paths, writes).catch((err: unknown) => ({
    judge: (): never => {
      throw err;
    },
    names: {},
  }));
  // Dispatch reads the manifest even without writes, but policy denials retain priority.
  const advice: PolicyDecision[] = [];
  const spawn = shared.host().spawnTool !== undefined && p.tool_name === shared.host().spawnTool;
  const dispatch = await (async () => {
    const manifest =
      ["Skill", "Agent", "Task"].includes(p.tool_name) || spawn
        ? withPluginDispatch(project, await loadManifest(project))
        : null;
    return (lifted: ReadonlySet<RuleCode>) => {
      const dispatched = spawn
        ? decideDispatch(
            "Agent",
            { ...p.tool_input, subagent_type: p.tool_input.agent_type },
            manifest,
            lifted,
          )
        : decideDispatch(p.tool_name, p.tool_input, manifest, lifted);
      if (dispatched.kind === "deny") advice.push(dispatched);
      return spawn
        ? decideAgentContext(p.tool_input.agent_type, p.tool_input.fork_turns, [
            // The read-only roles start fresh, so they judge the diff, not the writer's reasoning.
            ...(manifest?.roles?.reviewer ?? []),
            ...(manifest?.roles?.security ?? []),
          ])
        : ({ kind: "allow", reason: "dispatch audited" } as PolicyDecision);
    };
  })().catch((err: unknown) => (): never => {
    throw err;
  });
  // Policy precedes role and TDD gates; each still-denying rule needs its own override.
  // Undefined means no denial and no code/test write.
  const judge = (lifted: ReadonlySet<RuleCode>): Deny | Judged | undefined => {
    const rules = [action, ...files].map((a) => decide(a, ctx, lifted));
    const policy = strictest(rules);
    if (policy.kind === "deny") return policy;
    if (
      ctx.station &&
      p.tool_name.startsWith("mcp__") &&
      /write|edit|create|move|rename|delete|remove|patch|replace|insert|append|save/i.test(
        p.tool_name,
      ) &&
      files.length === 0
    )
      return {
        kind: "deny",
        code: "VERID_BURNT_STATION_WRITE",
        target: p.tool_name,
        reason: "write target is unknown",
      };
    if (stationSession)
      return {
        kind: "deny",
        code: "VERID_BURNT_STATION_SESSION",
        target: stationSession,
        reason: "session belongs to another station",
      };
    if (shared.host().knownTools) {
      const known = decideKnownTool(p.tool_name, shared.host().knownTools!);
      if (known.kind === "deny") return known;
    }
    if (adapted) {
      if (adapted.unknownTool) {
        const known = decideKnownTool(adapted.unknownTool, []);
        if (known.kind === "deny") return known;
      }
      for (const [field, code, reason] of [
        ["invalidPatch", "VERID_BURNT_PATCH_UNSUPPORTED", "unreadable patch"],
        ["unsupported", "VERID_BURNT_SHELL_UNSUPPORTED", "unreadable shell"],
      ] as const) {
        const target = adapted[field];
        if (target) return { kind: "deny", code, target, reason };
      }
    }
    const instructions = decideInstructions(p, writes, project, lifted);
    if (instructions.kind === "deny") return instructions;
    if (taskProblem)
      return {
        kind: "deny",
        code: "VERID_BURNT_TASK_SESSION",
        target: taskProblem,
        reason: taskProblem,
      };
    const dispatched = dispatch(lifted);
    if (dispatched.kind === "deny") return dispatched;
    const gated = gate.judge(lifted);
    return gated?.tdd.kind === "deny" ? gated.tdd : gated;
  };
  // A write of code or a test is a change like any other; an unfrozen test reopens RAW.
  const event = (j: Judged): shared.CycleEvent => ({
    session: p.session_id,
    tool: p.tool_name,
    target: j.write.display,
  });
  const change = (j: Judged): shared.Move => ({
    reopen: j.tdd.kind === "reopen",
    written: true,
    writer: p.agent_id,
  });
  const first = judge(new Set());
  for (const w of writes) {
    if (w.path !== ctx.planPath) continue;
    for (const [missing, code, reason] of [
      ["researchMissing", "VERID_BURNT_PLAN_NO_RESEARCH", "plan before research"],
      ["specMissing", "VERID_BURNT_PLAN_NO_SPEC", "plan before spec"],
      ["designMissing", "VERID_BURNT_PLAN_NO_DESIGN", "plan before design"],
    ] as const)
      if (ctx[missing]) advice.push({ kind: "deny", code, target: w.display, reason });
  }
  if (writes.length && (first === undefined || "write" in first)) {
    const manifest = await loadManifest(project);
    const writer = shared.writerFor(p.agent_id, p.agent_type, manifest?.roles);
    for (const w of writes) {
      const path = relative(project, resolve(p.cwd, w.display)).replaceAll("\\", "/");
      const e2e = manifest?.repos.some((repo) => {
        const rel = relative(resolve(project, repo.path), resolve(p.cwd, w.display)).replaceAll(
          "\\",
          "/",
        );
        return (repo.e2e_globs ?? []).some((glob) => matchesGlob(rel, glob));
      });
      const hint = roleAdvice(writer, e2e ? "e2e" : "free", w.display, path);
      if (hint.kind === "deny") advice.push(hint);
    }
  }
  let auditWarning = "";
  try {
    if (advice.length)
      withLock(paths, () => {
        for (const d of advice)
          if (d.kind === "deny")
            appendAudit(paths.audit, {
              event: "warning",
              code: d.code,
              target: d.target,
              reason: d.reason,
              session: p.session_id,
            });
      });
  } catch (err) {
    auditWarning = `verid: audit unavailable: ${err instanceof Error ? err.message : String(err)}\n`;
  }

  if (first === undefined || "write" in first) {
    if (first) shared.move(paths, event(first), change(first));
    // Only a pass to void is written, so other writes never wait on the state lock.
    else if (voidsSecurity)
      withLock(paths, () => writeState(paths, shared.withoutSecurity(readState(paths))));
    return { exit: 0, ...(auditWarning && { stderr: auditWarning }) };
  }

  const now = new Date().toISOString();
  const call = { session: p.session_id, tool: p.tool_name, input_hash: inputHash(p.tool_input) };
  return withLock(paths, () => {
    let state = readState(paths);
    let denied = first;
    const lifted = new Set<RuleCode>();
    for (;;) {
      const key = { ...call, rule: denied.code };
      const used = shared.host().overrides ? consumeOverride(state, key, now) : null;
      if (!used) {
        const target =
          isAbsolute(denied.target) && isUnder(normalizePath(denied.target), normalizePath(project))
            ? relative(project, denied.target).replaceAll("\\", "/")
            : denied.target;
        const last = state.last_denied;
        const repeated =
          last?.session === call.session &&
          last.rule === denied.code &&
          last.target === denied.target;
        const result = (repeated ? shared.denyAgain : shared.deny)(denied.code, {
          ...gate.names,
          target,
        });
        appendAudit(paths.audit, {
          event: "denied",
          ...key,
          target: denied.target,
          module: shared.usageModule(project, state, taskManifest ?? undefined),
          chars: shared.resultChars(result),
        });
        writeState(paths, recordDenial(state, { ...key, target: denied.target, at: now }));
        return result;
      }
      lifted.add(denied.code);
      // Before anything is written: a call verid cannot judge stays denied and keeps its override.
      const rest = judge(lifted);
      // Audit first: if it fails, state is untouched and the action stays denied.
      appendAudit(paths.audit, { event: "override_used", ...key, target: denied.target });
      state = used; // spent even when another rule still denies: that one needs its own /verid tip
      if (rest !== undefined && "code" in rest) {
        denied = rest;
        continue;
      }
      if (rest) state = shared.moved(paths, state, event(rest), change(rest));
      else if (voidsSecurity) state = shared.withoutSecurity(state);
      writeState(paths, state);
      return { exit: 0 };
    }
  });
}

type Deny = Extract<PolicyDecision, { kind: "deny" }>;
interface Who {
  writer: Writer;
  split: boolean;
}
const ANYONE: Who = { writer: "main", split: false };

interface Gate {
  /** Judge writes after overrides; undefined means no denial and no code/test write. */
  judge: (lifted: ReadonlySet<RuleCode>) => Judged | undefined;
  /** Who made the call and who holds each role, for the role rules' messages. */
  names: Record<string, string>;
}

async function tddGate(
  p: z.infer<typeof preToolUseSchema>,
  project: string,
  paths: StatePaths,
  writes: FileAction[],
): Promise<Gate> {
  const state = readState(paths); // no usable state → nothing is allowed
  // The TDD gate reads the manifest only for writes; no manifest means no gate.
  const manifest = writes.length > 0 ? await loadManifest(project) : null;
  if (!manifest) return { judge: () => undefined, names: {} };
  const { real, written } = tddLayouts(project, manifest);
  // Code needs an approved, unserved, unchanged module. Remix has no plan; auto follows
  // plan order and gets stuck when it needs the developer.
  const facts =
    manifest.drive === "auto"
      ? autoFactsOf(
          project,
          state,
          manifest.iterations !== undefined,
          planned(manifest),
          manifest.stations,
        )
      : null;
  // A write is judged before it runs, so a Bash `rm .verid/blocked.md` latches the file first.
  if (facts !== null && toLatch(state, facts.blockedFile))
    withLock(paths, () =>
      writeState(paths, latchBlocked(paths, readState(paths), facts.blockedFile, p.session_id)),
    );
  // A branch or a merge is looked for at Stop, SubagentStop and SessionStart only: never in a
  // tool call, whose hook the host lets through once it runs out of time.
  const auto = facts === null ? null : autoPhase(facts);
  const planApproved =
    manifest.mode === "remix" ||
    (auto ? auto.kind === "module" : shared.hasOpenModule(project, state, manifest));
  const lock: AutoLock | null = auto?.kind === "stuck" ? "VERID_BURNT_AUTO_STUCK" : null;
  const who = {
    writer: shared.writerFor(p.agent_id, p.agent_type, manifest.roles),
    split: shared.splitFor(manifest.roles),
  };
  const judge = (
    approved: boolean,
    by: (w: FileAction) => Who = () => who,
    locked = lock,
  ): Judged[] =>
    writes.flatMap((w) => {
      const asWritten = { ...w, path: writtenPath(resolve(p.cwd, w.display)) };
      const drive = auto ? { lock: locked } : undefined;
      return [
        { write: w, tdd: decideTdd(w, state.tdd, real, approved, by(w), drive) },
        { write: w, tdd: decideTdd(asWritten, state.tdd, written, approved, by(w), drive) },
      ];
    });
  const judged = judge(planApproved);
  return {
    judge: (lifted) => {
      // A write whose role rule was allowed is judged as anyone's: the cycle still applies.
      const roleLifted = (w: FileAction) =>
        judged.some(
          (j) =>
            j.write === w &&
            j.tdd.kind === "deny" &&
            j.tdd.code.startsWith("VERID_BURNT_ROLE_") &&
            lifted.has(j.tdd.code),
        );
      const planLifted =
        lifted.has("VERID_BURNT_PLAN_NOT_APPROVED") || lifted.has("VERID_BURNT_AUTO_NO_MODULE");
      // Rejudge without the auto lock so frozen-test and reopen rules still apply.
      const unlocked = lock !== null && lifted.has(lock);
      const again = planLifted || unlocked || writes.some(roleLifted);
      const base = again
        ? judge(
            planLifted || planApproved,
            (w) => (roleLifted(w) ? ANYONE : who),
            unlocked ? null : lock,
          )
        : judged;
      const harsh = harshest(base.map((j) => passed(j, lifted)));
      return harsh.tdd.kind === "allow" ? undefined : harsh;
    },
    names: roleNames(p.agent_id, p.agent_type, manifest.roles),
  };
}

function roleNames(
  agentId: string | undefined,
  agentType: string | undefined,
  roles: Roles | undefined,
): Record<string, string> {
  return {
    writer: agentId === undefined ? "main" : (agentType ?? "?"),
    ...shared.mappedNames(roles),
    document: ROLE_DOCUMENTS[shared.writerFor(agentId, agentType, roles)] ?? "—",
  };
}

interface Judged {
  write: FileAction;
  tdd: TddDecision;
}

const harshest = (judged: Judged[]): Judged =>
  judged.reduce((a, b) => (TDD_STRICTNESS[b.tdd.kind] > TDD_STRICTNESS[a.tdd.kind] ? b : a));

/** A rule the developer allowed no longer denies: the write counts as it would without that rule. */
function passed(j: Judged, lifted: ReadonlySet<RuleCode>): Judged {
  if (j.tdd.kind !== "deny" || !lifted.has(j.tdd.code)) return j;
  const kind = j.tdd.code === "VERID_BURNT_TDD_TEST_FROZEN" ? "reopen" : "code";
  return { ...j, tdd: { kind, reason: j.tdd.reason } };
}

/** An invariant beats an overridable rule: overriding the one must not let the other through. */
function strictest(decisions: PolicyDecision[]): PolicyDecision {
  const denies = decisions.filter((d) => d.kind === "deny");
  return (
    denies.find((d) => !isOverridable(d.code)) ??
    denies[0] ??
    decisions[0] ?? { kind: "allow", reason: "nothing to judge" }
  );
}
