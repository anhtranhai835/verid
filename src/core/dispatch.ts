import type { Manifest } from "./manifest.js";
import type { PolicyDecision, RuleCode } from "./errors.js";

export const DEFAULT_ALLOWED_SKILLS = [
  "verid:*",
  "superpowers:*",
  "andrej-karpathy-skills:*",
] as const;
type DispatchManifest = Pick<Manifest, "roles" | "allowed_skills" | "allowed_agents">;

export const skillAllowlist = (manifest?: DispatchManifest | null): string[] => [
  ...DEFAULT_ALLOWED_SKILLS,
  ...(manifest?.allowed_skills ?? []),
];
export const agentAllowlist = (manifest?: DispatchManifest | null): string[] => [
  ...new Set([
    ...Object.values(manifest?.roles ?? {}).flatMap((agents) => agents ?? []),
    ...(manifest?.allowed_agents ?? []),
  ]),
];

/** Additive dispatch rules: existing path, shell, role and TDD decisions still apply. */
export function decideDispatch(
  tool: string,
  input: Record<string, unknown>,
  manifest: DispatchManifest | null,
  lifted: ReadonlySet<RuleCode>,
): PolicyDecision {
  const skill = tool === "Skill";
  if (!skill && tool !== "Agent" && tool !== "Task")
    return { kind: "allow", reason: "not a dispatch" };
  const code = skill ? "VERID_BURNT_SKILL_NOT_ALLOWED" : "VERID_BURNT_AGENT_NOT_ALLOWED";
  const name = input[skill ? "skill" : "subagent_type"];
  const list = skill ? skillAllowlist(manifest) : agentAllowlist(manifest);
  const allowed =
    typeof name === "string" &&
    name !== "" &&
    list.some((entry) =>
      skill && entry.endsWith(":*")
        ? name.startsWith(entry.slice(0, -1)) && name.length > entry.length - 1
        : name === entry,
    );
  if (allowed || lifted.has(code)) return { kind: "allow", reason: "allowed dispatch" };
  return {
    kind: "deny",
    code,
    target: `${typeof name === "string" && name !== "" ? name : "<missing>"}; ${skill ? "allowed_skills" : "roles + allowed_agents"}: ${list.join(", ") || "(empty)"}`,
    reason: "dispatch outside the developer's allowlist",
  };
}

/** A reviewer starts with only the requested ACs, design path and diff. */
export function decideAgentContext(
  type: unknown,
  context: unknown,
  reviewers: readonly string[],
): PolicyDecision {
  return typeof type === "string" && reviewers.includes(type) && context !== "none"
    ? {
        kind: "deny",
        code: "VERID_BURNT_AGENT_CONTEXT",
        target: type,
        reason: "reviewer requires fork_turns none",
      }
    : { kind: "allow", reason: "fresh reviewer context" };
}

/** Unknown host tools cannot acquire write or dispatch permissions by default. */
export function decideKnownTool(tool: string, known: readonly string[]): PolicyDecision {
  return tool.startsWith("mcp__") || known.includes(tool)
    ? { kind: "allow", reason: "known tool" }
    : { kind: "deny", code: "VERID_BURNT_TOOL_UNSUPPORTED", target: tool, reason: "unknown tool" };
}
