import type { MessageKey, PolicyDecision } from "./errors.js";
import { ROLE_NAMES, type RoleName, type Roles } from "./manifest.js";
import type { TddState } from "./tdd.js";

/**
 * Who makes a tool call. Claude Code sets agent_id only in a subagent's payload, so a role is
 * trusted only with one: `claude --agent X` gives the main thread an agent_type without it.
 */
export type Writer = "main" | RoleName | "other";

/** Project-relative documents owned by the drafting roles. */
export const ROLE_DOCUMENTS: Partial<Record<Writer, string>> = {
  researcher: ".verid/research.md",
  architect: ".verid/design.md",
  planner: ".verid/plan.md",
};

export function writerOf(
  agentId: string | undefined,
  agentType: string | undefined,
  roles: Roles | undefined,
): Writer {
  if (agentId === undefined) return "main";
  if (agentType === undefined || !roles) return "other";
  return ROLE_NAMES.find((role) => roles[role]?.includes(agentType)) ?? "other";
}

/** The agents mapped to each role as messages name them: comma-separated, or — for none. */
export function mappedAgents(roles: Roles | undefined): Record<RoleName, string> {
  const list = (agents: string[] | undefined) => agents?.join(", ") ?? "—";
  return {
    reviewer: list(roles?.reviewer),
    tester: list(roles?.tester),
    coder: list(roles?.coder),
    researcher: list(roles?.researcher),
    architect: list(roles?.architect),
    planner: list(roles?.planner),
    qa: list(roles?.qa),
  };
}

/** Tests and production code have different writers once a tester and a coder are mapped. */
export const splitOn = (roles: Roles | undefined): boolean => !!roles?.tester && !!roles.coder;

/**
 * What a writer may write, before the TDD gate says when: a reviewer writes nothing, and once
 * split only the tester writes tests and only the coder writes production code. Drafting roles
 * own one project document; qa owns end-to-end tests, including when the work is split.
 */
export function decideRole(
  writer: Writer,
  split: boolean,
  file: "test" | "e2e" | "code" | "free" | "outside",
  target: string,
  documentPath: string | null = null,
): PolicyDecision {
  if (writer === "reviewer")
    return {
      kind: "deny",
      code: "VERID_BURNT_ROLE_READ_ONLY",
      target,
      reason: "a reviewer writes nothing",
    };
  const document = ROLE_DOCUMENTS[writer];
  if (document && documentPath !== document)
    return {
      kind: "deny",
      code: "VERID_BURNT_ROLE_DOC_ONLY",
      target,
      reason: `${writer} may write only ${document}`,
    };
  if (writer === "qa")
    return file === "e2e"
      ? { kind: "allow", reason: "qa writes an end-to-end test" }
      : {
          kind: "deny",
          code: "VERID_BURNT_ROLE_QA_E2E_ONLY",
          target,
          reason: "qa writes only end-to-end tests",
        };
  if (split && (file === "test" || file === "e2e") && writer !== "tester")
    return {
      kind: "deny",
      code: "VERID_BURNT_ROLE_TESTER_ONLY",
      target,
      reason: "only the tester writes tests",
    };
  if (split && file === "code" && writer !== "coder")
    return {
      kind: "deny",
      code: "VERID_BURNT_ROLE_CODER_ONLY",
      target,
      reason: "only the coder writes production code",
    };
  return { kind: "allow", reason: "the role allows it" };
}

/**
 * Why a subagent that wrote code or a test may not stop yet, as Stop holds the main thread: the
 * last run failed, a test still cannot load, or no run shows the latest change. A reviewer writes
 * nothing; qa and the split tester hand failing tests and stubs to the coder.
 */
export function subagentHold(
  writer: Writer,
  split: boolean,
  cycle: { state: TddState; stub: boolean; dirty: boolean },
): MessageKey | null {
  if (writer === "reviewer") return null;
  const tester = (split && writer === "tester") || writer === "qa";
  if (cycle.state === "COOKING" && !tester) return "stop.green";
  if (cycle.stub && !tester) return "stop.stub";
  return cycle.dirty ? "stop.unverified" : null;
}
