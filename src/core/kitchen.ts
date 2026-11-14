import type { AutoPhase } from "./auto.js";
import type { RuleCode } from "./errors.js";
import type { TddState } from "./tdd.js";

/** The no-brain board's crew: each agent role as a restaurant job. The customer is the user. */
export const ROLES = ["head_chef", "sous_chef", "cook", "taster", "inspector", "waiter"] as const;
export type Role = (typeof ROLES)[number];
/** Where a task's plate stands on the pass: a ticket, the TDD state while it cooks, or served. */
export const STATIONS = ["order", "RAW", "COOKING", "PLATED", "served"] as const;
type Station = (typeof STATIONS)[number];

export interface KitchenInput {
  /** null when the drive has no plan to follow (remix): the board's notice says why. */
  phase: AutoPhase | null;
  tdd: TddState;
  research: boolean;
  design: boolean;
  halted: string | null;
  denied: { rule: RuleCode; at: string } | null;
  /** Mode reheat: a unit that is ready except for the developer's parity signature. */
  parity?: string | null;
  tasks: readonly { id: string; title: string; column: string; selected: boolean; tdd?: string }[];
  now: number;
}

/** What the waiter tells the user: `board.waiter_<kind>` and `board.waiter_<kind>_next`. */
export interface WaiterLine {
  kind: string;
  params: Record<string, string>;
}

// ponytail: a denial counts as news for 15 minutes; state keeps only the last one and no
// "seen" mark, so after that the waiter assumes the kitchen moved past it.
const DENIAL_FRESH_MS = 15 * 60_000;

const denialKind = (rule: RuleCode) =>
  /_TDD_/.test(rule)
    ? "deny_tdd"
    : /_PLAN_/.test(rule)
      ? "deny_plan"
      : /_ROLE_|_AGENT_NOT_ALLOWED|_SKILL_NOT_ALLOWED/.test(rule)
        ? "deny_role"
        : /_AUTO_/.test(rule)
          ? "deny_auto"
          : "deny_guard";

function roleOf(input: KitchenInput): Role {
  const { phase } = input;
  if (input.halted !== null) return "waiter";
  if (phase === null) return "head_chef";
  switch (phase.kind) {
    case "unsigned":
      return input.research && !input.design ? "sous_chef" : "head_chef";
    case "plan":
      return "head_chef";
    case "module":
      // RAW: no red test yet; PLATED with the module still cooking: the next AC needs its test.
      return phase.view.phase === "evaluating"
        ? "inspector"
        : input.tdd === "COOKING"
          ? "cook"
          : "taster";
    default:
      return "waiter";
  }
}

/** Only when the user is needed: halted, blocked, a fresh denial, or all served. */
function waiterOf(input: KitchenInput): WaiterLine | null {
  const { phase, denied } = input;
  if (input.halted !== null) return { kind: "halted", params: { detail: input.halted } };
  if (phase?.kind === "stuck")
    return {
      kind: phase.reason === "blocked" ? "question" : "gate",
      params: { detail: phase.detail },
    };
  if (input.parity) return { kind: "parity", params: { detail: input.parity } };
  if (denied && input.now - Date.parse(denied.at) < DENIAL_FRESH_MS)
    return { kind: denialKind(denied.rule), params: { code: denied.rule } };
  if (phase?.kind === "done") return { kind: "done", params: {} };
  return null;
}

/** The no-brain board's restaurant, read from state only: no model call, no agent token. */
export function kitchenOf(input: KitchenInput) {
  return {
    role: roleOf(input),
    waiter: waiterOf(input),
    pass: input.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      station: (task.column === "done"
        ? "served"
        : task.selected
          ? (task.tdd ?? input.tdd)
          : "order") as Station,
    })),
  };
}
