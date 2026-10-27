import { agentAllowlist, skillAllowlist } from "./dispatch.js";
import type { Manifest, Provider, RoleName } from "./manifest.js";

const BEGIN = "<!-- verid:begin -->";
const END = "<!-- verid:end -->";
const INVALID = "expected one ordered verid:begin/verid:end marker pair";

export type InstructionBlock = { ok: true; block: string | null } | { ok: false; detail: string };

/** Markers are exact; ambiguous files must be repaired by the developer. */
export function instructionBlock(text: string): InstructionBlock {
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begin < 0 && end < 0) return { ok: true, block: null };
  if (
    begin < 0 ||
    end < begin ||
    text.indexOf(BEGIN, begin + BEGIN.length) >= 0 ||
    text.indexOf(END, end + END.length) >= 0
  )
    return { ok: false, detail: INVALID };
  return { ok: true, block: text.slice(begin, end + END.length) };
}

/** Replace only verid's exact span; insertion never rewrites the user's existing bytes. */
export function mergeInstructions(
  old: string | undefined,
  block: string,
): { ok: true; content: string } | { ok: false; detail: string } {
  const text = old ?? "";
  const current = instructionBlock(text);
  if (!current.ok) return current;
  if (current.block?.replaceAll("\r\n", "\n") === block) return { ok: true, content: text };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rendered = block.replaceAll("\n", eol);
  if (current.block !== null)
    return { ok: true, content: text.replace(current.block, () => rendered) };
  const separator = text === "" ? "" : text.endsWith("\n") ? eol : `${eol}${eol}`;
  return { ok: true, content: `${text}${separator}${rendered}${eol}` };
}

export function instructionFile(provider: Provider): "CLAUDE.md" | "AGENTS.md" {
  return provider === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
}

/** A compact index of installed skills, never a copy of their instructions. */
export function renderInstructions(
  manifest: Manifest,
  provider: Provider,
  skillsRoot = "plugin/skills",
): string {
  const agents = (role: RoleName): string => manifest.roles?.[role]?.join(", ") ?? "main";
  return [
    BEGIN,
    "## verid",
    provider === "claude-code"
      ? "Claude Code hooks enforce TDD (RAW → COOKING → PLATED), gates, roles, protected files and dispatch allowlists."
      : "Codex hooks enforce TDD, gates, protected files and agent allowlists as strictly as the host allows; run verid doctor and trust the hooks in /hooks.",
    "State: .verid/manifest.yaml; .verid/research.md, design.md and plan.md; local evidence and audit in .verid/.state/.",
    "Developer terminal: verid cook, upgrade, stock, order [module], serve <module>, garnish. Diagnostics: verid doctor, menu, peek. Agent evidence: verid taste.",
    ...(provider === "codex"
      ? [
          `Research/design: verid:design → ${skillsRoot.replaceAll("\\", "/")}/design/SKILL.md (main agent).`,
          `Plan: verid:plan → ${skillsRoot.replaceAll("\\", "/")}/plan/SKILL.md (main agent).`,
          `Build: verid:build → ${skillsRoot.replaceAll("\\", "/")}/build/SKILL.md; the main agent writes tests and code under the TDD gate.`,
          `Review/serve: verid:review → ${skillsRoot.replaceAll("\\", "/")}/review/SKILL.md; spawn verid_reviewer with agent_type and fork_turns: "none", only module ACs, .verid/design.md path and diff. Reviewer mappings: ${agents("reviewer")}.`,
        ]
      : [
          `Research/design: verid:design → researcher ${agents("researcher")}; architect ${agents("architect")}.`,
          `Plan: verid:plan → planner ${agents("planner")}.`,
          `Build: verid:build → tester ${agents("tester")}, qa ${agents("qa")} for end-to-end tests, coder ${agents("coder")}.`,
          `Review/serve: verid:review → reviewer ${agents("reviewer")}${manifest.roles?.security ? `, then security reviewer ${agents("security")}` : ""}.`,
        ]),
    `Skill allowlist: ${skillAllowlist(manifest).join("; ")}.${provider === "codex" ? " Advisory on Codex: skill activation has no universal hook." : ""}`,
    `Agent allowlist (roles plus allowed_agents): ${agentAllowlist(manifest).join("; ") || "none"}.`,
    provider === "codex"
      ? "Call the installed skills by absolute path; do not copy their text. Only the developer edits the manifest; /verid tip and /verid confirm have no effect on Codex; exceptions require Claude Code. Use verid peek and verid menu in the terminal; never bypass a denial."
      : "Call the installed skills; do not copy their text. Only the developer edits the manifest or opens exceptions with /verid tip and /verid confirm; never bypass a denial.",
    END,
  ].join("\n");
}
