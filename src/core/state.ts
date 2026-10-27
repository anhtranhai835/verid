// zod/mini tree-shakes to ~40 KB; full zod added ~65 ms to every hook start (Phase 0 measurement).
import * as z from "zod/mini";
import { RULE_CODES } from "./errors.js";
import { TDD_STATES } from "./tdd.js";

/** State written before the codes were renamed holds rule codes under this prefix. */
const LEGACY_CODE_PREFIX = "VERID_E_";

const rule = z.pipe(
  z.transform((v) =>
    typeof v === "string" && v.startsWith(LEGACY_CODE_PREFIX)
      ? `VERID_BURNT_${v.slice(LEGACY_CODE_PREFIX.length)}`
      : v,
  ),
  z.enum(RULE_CODES),
);

/** State written before the cycle was renamed holds the superpowers names. */
const LEGACY_STATES = new Map([
  ["RED", "RAW"],
  ["GREEN", "COOKING"],
  ["REFACTOR", "PLATED"],
]);

const tddState = z.pipe(
  z.transform((v) => (typeof v === "string" ? (LEGACY_STATES.get(v) ?? v) : v)),
  z.enum(TDD_STATES),
);

const deniedAction = z.strictObject({
  session: z.string(),
  tool: z.string(),
  target: z.string(),
  input_hash: z.string(),
  rule,
  at: z.string(),
});

const pendingOverride = z.strictObject({
  session: z.string(),
  code: z.string(),
  reason: z.string(),
  rule,
  tool: z.string(),
  target: z.string(),
  input_hash: z.string(),
  created_at: z.string(),
});

const override = z.strictObject({
  session: z.string(),
  rule,
  tool: z.string(),
  target: z.string(),
  input_hash: z.string(),
  reason: z.string(),
  created_at: z.string(),
  used: z.boolean(),
  used_at: z.optional(z.string()),
});

const tdd = z.strictObject({
  state: tddState,
  /** Id of the last run that counted as evidence, under .state/runs/. */
  last_run: z.nullable(z.string()),
  /** failureKey() of each test that failed in that run. */
  failing: z._default(z.array(z.string()), []),
  /** Bumped on every change to the cycle, so `verid taste` can tell its run went stale. */
  rev: z._default(z.int().check(z.nonnegative()), 0),
  /** Production code or a test was written after last_run: no run shows the latest change. */
  dirty: z._default(z.boolean(), false),
  /** AC codes named by a test that passed in that run. */
  passed_acs: z._default(z.array(z.string()), []),
  /** The part of passed_acs named by an end-to-end test (core/tdd.ts e2eCases). */
  passed_e2e_acs: z._default(z.array(z.string()), []),
  /** RAW only: a new test could not load, so production code may add what it needs to run. */
  stub: z._default(z.boolean(), false),
  /** Ids of the tests that failed in that run without reaching an assertion. */
  crashed: z._default(z.array(z.string()), []),
});

/**
 * What `verid order <module>` recorded: the sha256 of the module's section of plan.md and the
 * AC codes it lists; `verid serve` adds when the module was closed.
 */
const moduleApproval = z.strictObject({
  sha256: z.string(),
  acs: z.array(z.string()),
  at: z.string(),
  served_at: z._default(z.nullable(z.string()), null),
  /** sha256 of `.verid/design.md` when it was ordered; null for an order made before designs. */
  design_sha256: z._default(z.nullable(z.string()), null),
});

const count = z._default(z.int().check(z.nonnegative()), 0);

/**
 * Where an auto-driven run stands (`drive: auto`); a project driven by a developer keeps the
 * defaults. Every limit is counted here, in state, so a restart of the conversation cannot reset it.
 */
const autoState = z.strictObject({
  /** The research and design the developer approved to start the run, by hash; null until then. */
  signed: z._default(
    z.nullable(
      z.strictObject({
        research_sha256: z.string(),
        design_sha256: z.string(),
        at: z.string(),
        /** In a git repository when signed; false for a signature made before this was recorded. */
        git: z._default(z.boolean(), false),
        /** Git presence at signing for each repo path; absent on older signatures. */
        git_repos: z.optional(z.record(z.string(), z.boolean())),
      }),
    ),
    null,
  ),
  /** sha256 of `.verid/plan.md` as the reviewer passed it. */
  plan_sha256: z._default(z.nullable(z.string()), null),
  plan_reviews: count,
  /** Rounds the coder has had on each AC, by AC code. */
  coder_rounds: z._default(z.record(z.string(), z.int().check(z.nonnegative())), {}),
  module_reviews: count,
  /** Security reviews the open module has failed; its own limit, apart from module_reviews. */
  security_reviews: count,
  stop_holds: count,
  /** What had progressed when Stop last held the conversation; the same key again means none. */
  progress: z._default(z.nullable(z.string()), null),
  /** Why the run is stuck, copied from `.verid/blocked.md`; null while it is not. */
  blocked: z._default(z.nullable(z.string()), null),
});

/** A read-only reviewer's recorded report on the open module. */
const report = z.strictObject({
  module: z.string(),
  agent_type: z.string(),
  file: z.string(),
  sha256: z.string(),
  at: z.string(),
  /** Whether the report passed the module; a report written before verdicts counts as fail. */
  verdict: z._default(z.enum(["pass", "fail"]), "fail"),
});

/**
 * What a repo's architecture check showed in a `verid taste`, recorded only when the snapshot it
 * ran on (files, settings, design and module) was unchanged by the end of the run.
 */
const architectureResult = z.strictObject({
  snapshot: z.string(),
  status: z.enum(["pass", "fail", "unavailable"]),
  run: z.string(),
  /** The checker's output, relative to the project. */
  log: z.string(),
  at: z.string(),
  /** Why an unavailable check showed nothing: a timeout, or a command that did not start. */
  detail: z._default(z.string(), ""),
});

/** Every field has a default, so this is what a project that never ran auto holds. */
export const FRESH_AUTO = autoState.parse({});

/**
 * Every field except schemaVersion has a default, so a developer can bootstrap state
 * with `{"schemaVersion":1}`, which is what `verid cook` writes. Unknown fields are
 * rejected rather than silently dropped.
 */
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  counters: z._default(z.strictObject({ blocked_actions: z.int().check(z.nonnegative()) }), {
    blocked_actions: 0,
  }),
  last_denied: z._default(z.nullable(deniedAction), null),
  pending_override: z._default(z.nullable(pendingOverride), null),
  overrides: z._default(z.array(override), []),
  // A new project starts in RAW: no production code without a failing test first.
  tdd: z._default(tdd, {
    state: "RAW",
    last_run: null,
    failing: [],
    rev: 0,
    dirty: false,
    passed_acs: [],
    passed_e2e_acs: [],
    stub: false,
    crashed: [],
  }),
  /** failureKey() of each test already failing when `verid stock` ran; null until then. */
  baseline: z._default(z.nullable(z.array(z.string())), null),
  /** The plan modules the developer approved, by name; empty until `verid order`. */
  modules: z._default(z.record(z.string(), moduleApproval), {}),
  /** The conversation Stop already held for ACs without a passing test; null before that. */
  ac_stop_session: z._default(z.nullable(z.string()), null),
  /** The language this machine's developer chose at `verid cook`; null prints both. */
  language: z._default(z.nullable(z.enum(["vi", "en"])), null),
  /** The test runners verid found and ran (runnerKey()), when the manifest has no test_cmd. */
  runners: z._default(z.array(z.string()), []),
  /**
   * The mapped reviewer's final report for the open module, written by the hook when it stopped;
   * `file` is relative to the project. Any later code or test write, and `verid order`, clear it.
   */
  review: z._default(z.nullable(report), null),
  /**
   * The mapped security reviewer's final report for the open module, recorded and voided as the
   * review is. A module closes only on its pass when `roles.security` is mapped.
   */
  security: z._default(z.nullable(report), null),
  /** agent_id of each subagent let write code or a test that has not stopped since. */
  writers: z._default(z.array(z.string()), []),
  auto: z._default(autoState, FRESH_AUTO),
  /** Each configured repo's last architecture check, by repo path; every evidence run clears it. */
  architecture: z._default(z.record(z.string(), architectureResult), {}),
});

export type State = z.infer<typeof stateSchema>;
export type ArchitectureResult = z.infer<typeof architectureResult>;
export type AutoState = State["auto"];
export type DeniedAction = z.infer<typeof deniedAction>;
export type PendingOverride = z.infer<typeof pendingOverride>;
export type Override = z.infer<typeof override>;

export type ParseStateResult =
  | { ok: true; state: State }
  | { ok: false; code: "VERID_BURNT_STATE_CORRUPT" | "VERID_BURNT_STATE_VERSION" };

export function parseState(raw: string): ParseStateResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: "VERID_BURNT_STATE_CORRUPT" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json))
    return { ok: false, code: "VERID_BURNT_STATE_CORRUPT" };
  // Never guess the shape of a version we do not know.
  if ((json as { schemaVersion?: unknown }).schemaVersion !== 1)
    return { ok: false, code: "VERID_BURNT_STATE_VERSION" };
  // 0.1.0-beta.1 approved the whole plan; a plan without module headings is the module main,
  // whose section is the whole file, so that approval still holds.
  const { plan, ...rest } = json as { plan?: unknown };
  const upgraded =
    plan === undefined
      ? json
      : plan === null
        ? rest
        : { ...rest, modules: { main: { ...(plan as object), served_at: null } } };
  const parsed = stateSchema.safeParse(upgraded);
  return parsed.success
    ? { ok: true, state: parsed.data }
    : { ok: false, code: "VERID_BURNT_STATE_CORRUPT" };
}
