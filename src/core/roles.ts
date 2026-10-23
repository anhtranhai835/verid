import type { MessageKey, PolicyDecision } from "./errors.js";
import type { Roles } from "./manifest.js";
import type { TddState } from "./tdd.js";

/**
 * Who makes a tool call. Claude Code sets agent_id only in a subagent's payload, so a role is
 * trusted only with one: `claude --agent X` gives the main thread an agent_type without it.
 */
export type Writer = "main" | "reviewer" | "tester" | "coder" | "other";

export function writerOf(
  agentId: string | undefined,
  agentType: string | undefined,
  roles: Roles | undefined,
): Writer {
  if (agentId === undefined) return "main";
  if (agentType === undefined || !roles) return "other";
  if (roles.reviewer?.includes(agentType)) return "reviewer";
  if (roles.tester?.includes(agentType)) return "tester";
  if (roles.coder?.includes(agentType)) return "coder";
  return "other";
}

/** The agents mapped to each role as messages name them: comma-separated, or — for none. */
export function mappedAgents(
  roles: Roles | undefined,
): Record<"reviewer" | "tester" | "coder", string> {
  const list = (agents: string[] | undefined) => agents?.join(", ") ?? "—";
  return {
    reviewer: list(roles?.reviewer),
    tester: list(roles?.tester),
    coder: list(roles?.coder),
  };
}

/** Tests and production code have different writers once a tester and a coder are mapped. */
export const splitOn = (roles: Roles | undefined): boolean => !!roles?.tester && !!roles.coder;

/**
 * What a writer may write, before the TDD gate says when: a reviewer writes nothing, and once
 * split only the tester writes tests and only the coder writes production code. Other files,
 * and files outside the repo, are anyone's but the reviewer's.
 */
export function decideRole(
  writer: Writer,
  split: boolean,
  file: "test" | "code" | "free" | "outside",
  target: string,
): PolicyDecision {
  if (writer === "reviewer")
    return {
      kind: "deny",
      code: "VERID_BURNT_ROLE_READ_ONLY",
      target,
      reason: "a reviewer writes nothing",
    };
  if (split && file === "test" && writer !== "tester")
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
 * nothing; once split, failing tests and the stub are the coder's to finish, not the tester's.
 */
export function subagentHold(
  writer: Writer,
  split: boolean,
  cycle: { state: TddState; stub: boolean; dirty: boolean },
): MessageKey | null {
  if (writer === "reviewer") return null;
  const tester = split && writer === "tester";
  if (cycle.state === "COOKING" && !tester) return "stop.green";
  if (cycle.stub && !tester) return "stop.stub";
  return cycle.dirty ? "stop.unverified" : null;
}
