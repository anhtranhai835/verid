import { type Host, claudeHost, type Result } from "../adapters/host.js";
import { writerOf, singleWriterOf, splitOn, mappedAgents } from "../core/roles.js";
import { type Roles, type Manifest, planned } from "../core/manifest.js";
import {
  type StatePaths,
  withLock,
  writeState,
  readState,
  statePaths,
  VeridError,
} from "../adapters/state-store.js";
import { type State } from "../core/state.js";
import { appendAudit } from "../adapters/audit-log.js";
import { readPlan, servedSections, planViews, autoFactsOf } from "../adapters/plan-file.js";
import { openModule } from "../core/plan.js";
import { autoPhase } from "../core/auto.js";
import { bilingual, type Lang, t, inLanguage } from "../adapters/i18n.js";
import {
  type ErrorCode,
  RULE_CODES,
  type RuleCode,
  type MessageKey,
  isOverridable,
} from "../core/errors.js";
import type * as z from "zod/mini";
import { type Cycle, cycleLabel } from "../core/tdd.js";
import { resolveProject } from "../adapters/project.js";

export const statusLine = (mode: string, cycle: Cycle, lastRun: string | null) =>
  `verid: TDD ${cycleLabel(cycle)} · mode ${mode} · last run ${lastRun ?? "none"}`;

// The host that sent this payload (adapters/host.ts). Rules ask what it can do, never its name.
// ponytail: one module-wide host set by each run(); overlapping runs in one process would race.
let HOST: Host = claudeHost;
export const setHost = (value: Host): void => {
  HOST = value;
};
export const host = (): Host => HOST;
export const projectDir = (cwd: string) => resolveProject(cwd, HOST.projectDir(cwd));
export const writerFor: typeof writerOf = (...args) =>
  (HOST.singleWriter ? singleWriterOf : writerOf)(...args);
export const splitFor = (roles: Roles | undefined) => !HOST.singleWriter && splitOn(roles);
export const mappedNames = (roles: Roles | undefined) => mappedAgents(roles, HOST.singleWriter);
export const sessionKey = (session: string) => `${HOST.id}:${session}`;

export const resultChars = (result: Result): number =>
  (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0);

export function usageModule(
  project: string,
  state: State,
  manifest?: Manifest,
): string | undefined {
  return (
    state.kanban.active?.module ??
    state.auto.work?.module ??
    openModuleName(project, state, manifest)
  );
}

export interface CycleEvent {
  session: string;
  tool: string;
  target: string;
}
/** Reopen RAW, mark changed code/tests, and remember writers until a verifying run. */
export interface Move {
  reopen: boolean;
  written: boolean;
  writer?: string | undefined;
}

export function move(paths: StatePaths, event: CycleEvent, change: Move): void {
  withLock(paths, () => writeState(paths, moved(paths, readState(paths), event, change)));
}

/** Bump rev to invalidate in-flight runs; changed tests reopen RAW and writes need verification. */
export function moved(paths: StatePaths, state: State, event: CycleEvent, change: Move): State {
  // Audit only real changes of state: test writes in RAW are routine.
  if (change.reopen && state.tdd.state !== "RAW")
    appendAudit(paths.audit, { event: "tdd_reopened", ...event, from: state.tdd.state });
  const tdd = { ...state.tdd, rev: state.tdd.rev + 1 };
  if (change.reopen) tdd.state = "RAW";
  if (change.written) tdd.dirty = true;
  const writers =
    change.writer === undefined || state.writers.includes(change.writer)
      ? state.writers
      : [...state.writers, change.writer];
  // A review covers the code it read: a change after it needs another, and so does a security review.
  return {
    ...state,
    tdd,
    writers,
    ...(change.written && {
      review: null,
      security: null,
      review_epoch: state.review_epoch + 1,
      security_epoch: state.security_epoch + 1,
    }),
  };
}

export const withoutSecurity = (state: State): State => ({
  ...state,
  security: null,
  security_epoch: state.security_epoch + 1,
});

/** A missing or broken plan has no open module, so production code stays locked. */
export function hasOpenModule(project: string, state: State, manifest: Manifest): boolean {
  return openModuleName(project, state, manifest) !== undefined;
}

export function openModuleName(
  project: string,
  state: State,
  manifest?: Manifest,
): string | undefined {
  const plan = readPlan(
    project,
    manifest?.iterations !== undefined,
    manifest ? planned(manifest) : false,
    servedSections(state),
  );
  if (!plan?.ok) return undefined;
  const views = planViews(project, plan, state);
  return openModule(views)?.name;
}

/** The module whose log a session reads, in either drive; undefined when none is open or in remix. */
export function loggedModule(
  project: string,
  manifest: Manifest,
  state: State,
): string | undefined {
  if (manifest.mode === "remix") return undefined;
  if (manifest.drive !== "auto") return openModuleName(project, state, manifest);
  const phase = autoPhase(
    autoFactsOf(
      project,
      state,
      manifest.iterations !== undefined,
      planned(manifest),
      manifest.stations,
    ),
  );
  return phase.kind === "module" ? phase.view.name : undefined;
}

/** Unreadable state is not a halt; later rules still judge its errors. */
export function haltedBy(paths: ReturnType<typeof statePaths>): { reason: string } | null {
  try {
    return readState(paths).halted;
  } catch {
    return null;
  }
}

export const haltedLines = (halted: { reason: string }) =>
  `verid: halted · ${halted.reason}\n${bilingual("halt.notice", {})}\n`;

/** The first sentence of a message: what is blocked and why, without the rest of the advice. */
const firstSentence = (text: string): string => /^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text;

/**
 * The same rule denying the same target again in one session: the code and the first sentence
 * of the reason, since the full reason is already in the agent's context.
 */
export function denyAgain(code: ErrorCode, params: Record<string, string>): Result {
  const line = (lang: Lang) =>
    t(lang, "deny.repeat", { reason: firstSentence(t(lang, code, params)) });
  return { exit: 2, stderr: `verid [${code}]\n${inLanguage(line)}\n` };
}

export function deny(code: ErrorCode, params: Record<string, string>): Result {
  const rule = (RULE_CODES as readonly string[]).includes(code) ? (code as RuleCode) : undefined;
  const hint: MessageKey | undefined =
    rule && HOST.overrides
      ? isOverridable(rule)
        ? "hint.overridable"
        : "hint.not_overridable"
      : undefined;
  const line = (lang: Lang) => `${t(lang, code, params)}${hint ? ` ${t(lang, hint, params)}` : ""}`;
  return { exit: 2, stderr: `verid [${code}]\n${inLanguage(line)}\n` };
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new VeridError("VERID_BURNT_PAYLOAD", { detail: "not JSON" });
  }
}

export function parse<S extends z.ZodMiniType>(schema: S, payload: unknown): z.infer<S> {
  const r = schema.safeParse(payload);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new VeridError("VERID_BURNT_PAYLOAD", {
    detail: issue ? `${issue.path.join(".") || "payload"}: ${issue.message}` : "invalid",
  });
}
