import { skillAllowlist } from "./dispatch.js";
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
  const skill = (name: string): string => `${skillsRoot.replaceAll("\\", "/")}/${name}/SKILL.md`;
  const codex = provider === "codex";
  const extras =
    [...(manifest.allowed_skills ?? []), ...(manifest.allowed_agents ?? [])].length > 0;
  return [
    BEGIN,
    "## verid",
    "",
    "### Rules",
    codex
      ? "- Codex hooks enforce TDD, gates and protected files as strictly as the host allows; run verid doctor and trust the hooks in /hooks."
      : "- Claude Code hooks enforce TDD (RAW → COOKING → PLATED), module approval, roles and protected files.",
    "- Never bypass or work around a denial: read its reason and follow it.",
    codex
      ? "- Only the developer edits the manifest; /verid tip and /verid confirm have no effect on Codex; exceptions require Claude Code."
      : "- Only the developer edits the manifest or opens exceptions with /verid tip and /verid confirm.",
    codex
      ? "- Call the installed skills by absolute path; do not copy their text."
      : "- Call the installed skills; do not copy their text.",
    "",
    "### TDD cycle",
    "- RAW: production code is locked. Write one failing test, then run verid taste.",
    "- COOKING: tests are frozen. Write the minimum production code to pass them, then run verid taste.",
    "- PLATED: all tests pass. Refactor without new behaviour; the next test starts RAW.",
    "",
    "### Workflow",
    "- Start of a session: run verid peek for the cycle and the next step.",
    `- New developer or workspace: verid:onboard${codex ? ` → ${skill("onboard")}` : ""} reads repos, health and status, and writes nothing.`,
    ...(codex
      ? [
          `- Research, then spec: verid:ba → ${skill("ba")} (main agent).`,
          `- Design: verid:design → ${skill("design")} (main agent).`,
          `- Plan: verid:plan → ${skill("plan")} (main agent).`,
          `- Build: verid:build → ${skill("build")}; the main agent writes tests and code under the TDD gate.`,
          `- TDD: verid:tdd → ${skill("tdd")}; debugging: verid:debugging → ${skill("debugging")}.`,
          `- Review/serve: verid:review → ${skill("review")}; spawn verid_reviewer with agent_type and fork_turns: "none", module/AC identifiers, plan/design paths and .verid/review/work.md from verid menu --commits --file. Reviewer mappings: ${agents("reviewer")}.`,
          "- Codex spawns only agents defined in its config, such as verid_reviewer; the verid:* agents belong to the Claude Code plugin.",
        ]
      : [
          "- Research, then spec: verid:ba in the main conversation.",
          `- Design: verid:design → architect ${agents("architect")}.`,
          `- Plan: verid:plan → planner ${agents("planner")}.`,
          `- Build: verid:build → tester ${agents("tester")}, qa ${agents("qa")} for end-to-end tests, coder ${agents("coder")}; verid:tdd for each cycle, verid:debugging for unclear failures.`,
          `- Review/serve: verid:review → reviewer ${agents("reviewer")}${manifest.roles?.security ? `, then security reviewer ${agents("security")}` : ""}.`,
        ]),
    "- In the bundled debugging skill, TDD and verification mean verid:tdd and a passing verid taste after the last change.",
    `- ClaudeKit skills: ${skillsRoot.replaceAll("\\", "/")}/`,
    "",
    "### Commands",
    "- Agent: verid taste (the only test runs that count as evidence), verid peek, verid menu, verid doctor.",
    "- Developer only, in their own terminal: verid cook, upgrade, stock, order [module], serve <module>, garnish, halt, resume.",
    "",
    "### Files",
    "- Inputs: the developer's documents in .verid/docs/ (agents read them, never write them).",
    "- Session log: .verid/log/<module>.md; read it at session start, and the main thread appends after each AC.",
    "- State: .verid/manifest.yaml; .verid/research.md, spec.md, design.md and plan.md; local evidence and audit in .verid/.state/.",
    "- Conventions (advisory; audit warns without blocking): .verid/rules/git.md, architecture.md, workflow.md. Read them when relevant.",
    "",
    // The defaults (verid:* and the roles above) need no list; only additions are worth the tokens.
    ...(extras
      ? [
          "### Allowlists (audit)",
          `- Known skills: ${skillAllowlist(manifest).join("; ")}.${codex ? " Advisory on Codex: skill activation has no universal hook." : ""}`,
          `- Known mapped/extra agents: ${
            [
              ...new Set([
                ...Object.values(manifest.roles ?? {}).flatMap((names) => names ?? []),
                ...(manifest.allowed_agents ?? []),
              ]),
            ].join("; ") || "none"
          }.`,
          "",
        ]
      : []),
    "### Feedback on verid",
    "- On friction with verid itself (a confusing denial, an unclear skill, a stuck drive, a workaround), the main thread appends a dated entry to .verid/feedback.md: friction, gap or bug; the skill, code or command; what happened; a suggestion. Subagents report it to main. Never edit or remove entries or copy source, test output, transcripts or secrets into it; project bugs belong elsewhere.",
    END,
  ].join("\n");
}
