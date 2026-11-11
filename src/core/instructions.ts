import { planned, taskSessions } from "./manifest.js";
import { skillAllowlist } from "./dispatch.js";
import { PROVIDERS, type Manifest, type Provider, type RoleName } from "./manifest.js";

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

/** CLAUDE.md's whole verid block: Claude Code reads the shared block through this import. */
const CLAUDE_IMPORT = [BEGIN, "@AGENTS.md", END].join("\n");

/**
 * What cook writes between the markers of each instruction file. AGENTS.md is the one source,
 * read by Codex and imported by CLAUDE.md. With both providers its block holds each line once;
 * a line only one provider needs is labelled with it.
 */
export function instructionBlocks(
  manifest: Manifest,
  skillsRoot = "plugin/skills",
): { file: "AGENTS.md" | "CLAUDE.md"; block: string }[] {
  const providers = manifest.providers ?? ["claude-code"];
  const claude = providers.includes("claude-code");
  // In a fixed order, so the block does not depend on how the manifest lists them.
  const ordered = PROVIDERS.filter((provider) => providers.includes(provider));
  const shared =
    ordered.length === 1
      ? renderInstructions(manifest, ordered[0]!, skillsRoot)
      : mergeProviders(
          ordered.map((provider) => ({
            name: PROVIDER_LABELS[provider],
            text: renderInstructions(manifest, provider, skillsRoot),
          })),
        );
  return [
    { file: "AGENTS.md", block: shared },
    ...(claude ? [{ file: "CLAUDE.md" as const, block: CLAUDE_IMPORT }] : []),
  ];
}

const PROVIDER_LABELS: Record<Provider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
};

/**
 * Section by section: lines every provider has once, then the others in provider order, each
 * labelled with the providers it is for.
 */
function mergeProviders(rendered: { name: string; text: string }[]): string {
  const sections = (text: string) =>
    text.split("\n").reduce<string[][]>((all, line) => {
      if (line.startsWith("#") || line === BEGIN || line === END || all.length === 0) all.push([]);
      all.at(-1)!.push(line);
      return all;
    }, []);
  const split = rendered.map((r) => sections(r.text));
  return split[0]!
    .flatMap((first, i) => {
      const each = split.map((s) => s[i] ?? []);
      const label = (line: string) => {
        const names = rendered.filter((_, k) => each[k]!.includes(line)).map((r) => r.name);
        return names.length === rendered.length
          ? line
          : line.replace(/^- /, `- (${names.join(", ")}) `);
      };
      const own = first.map(label);
      const extra = each
        .slice(1)
        .flatMap((lines, k) =>
          lines.filter((line) => !each.slice(0, k + 1).some((earlier) => earlier.includes(line))),
        )
        .filter((line, at, all) => all.indexOf(line) === at)
        .map(label);
      const blank = own.at(-1) === "" ? own.length - 1 : own.length;
      return [...own.slice(0, blank), ...extra, ...own.slice(blank)];
    })
    .join("\n");
}

/** A compact index of installed skills, never a copy of their instructions. */
export function renderInstructions(
  manifest: Manifest,
  provider: Provider,
  skillsRoot = "plugin/skills",
): string {
  const agents = (role: RoleName): string => manifest.roles?.[role]?.join(", ") ?? "main";
  const skill = (name: string): string => `${skillsRoot.replaceAll("\\", "/")}/${name}/SKILL.md`;
  const routing = `${skillsRoot.replaceAll("\\", "/")}/../templates/skill-routing.md`;
  const codex = provider === "codex";
  // Codex and Antigravity: the main agent writes; skills are read by path.
  const single = provider !== "claude-code";
  const antigravity = provider === "antigravity";
  const extras =
    [...(manifest.allowed_skills ?? []), ...(manifest.allowed_agents ?? [])].length > 0;
  const rendered = [
    BEGIN,
    "## verid",
    "",
    "### Rules",
    codex
      ? "- Codex hooks enforce TDD, gates and protected files as strictly as the host allows; run verid doctor and trust the hooks in /hooks."
      : antigravity
        ? "- Antigravity hooks enforce TDD (RAW → COOKING → PLATED), module approval and protected files; verid doctor checks the plugin."
        : "- Claude Code hooks enforce TDD (RAW → COOKING → PLATED), module approval, roles and protected files.",
    "- Never bypass a denial; follow its reason.",
    codex
      ? "- Only the developer edits the manifest; /verid tip and /verid confirm have no effect on Codex; exceptions require Claude Code."
      : antigravity
        ? "- Only the developer edits the manifest or opens exceptions with /verid tip and /verid confirm typed in the Antigravity chat."
        : "- Only the developer edits the manifest or opens exceptions with /verid tip and /verid confirm.",
    manifest.resources === "repo"
      ? "- Read skills and agents from .verid/skills/ and .verid/agents/ in this repo. Local verid-<name> entries route there; calls written verid:<name> in those files mean verid-<name> here. Resolve supporting files relative to the repo copy."
      : single
        ? "- Call the installed skills by absolute path; do not copy their text."
        : "- Call the installed skills; do not copy their text.",
    ...(manifest.resources === "repo"
      ? [
          "- Run every verid CLI command as node .verid/verid.mjs <command> from the project root, including cook after cloning. The CLI and runtime dependencies are bundled in this repo; Node.js is required.",
        ]
      : []),
    "",
    "### TDD cycle",
    "- RAW: code locked; write a failing test, then verid taste.",
    "- COOKING: tests frozen; implement, then verid taste.",
    "- PLATED: refactor passing code; new behaviour starts RAW.",
    "",
    "### Workflow",
    `- Routing: ${routing}; matching branches only.`,
    ...(taskSessions(manifest)
      ? [
          "- Human: developer order → fresh session → TDD/review → developer serve → stop.",
          "- ONE TASK PER SESSION: only the selected task; fresh session required. Resume/compact keeps it; /clear never authorizes switching.",
        ]
      : []),
    ...(planned(manifest)
      ? [
          `- Modules: read .verid/workflow.md and ${skill("modules")}. Run verid module <name>; write detail once in its dossier. Every plan module needs Artifacts: .verid/artifacts/03-modules/<name>.`,
          "- Templates: .verid/templates/; main records evidence; reviewers read only.",
          ...(manifest.drive === "auto"
            ? [
                "- AI: developer sets priorities in verid board and signs with verid order. One session follows that queue through TDD/review/serve; current work stays first.",
              ]
            : []),
        ]
      : []),
    `- Onboarding: verid:onboard${single ? ` → ${skill("onboard")}` : ""}; read-only health/status.`,
    ...(single
      ? [
          `- Research/spec: verid:ba → ${skill("ba")}.`,
          `- Design: verid:design → ${skill("design")}.`,
          `- Plan: verid:plan → ${skill("plan")}.`,
          `- Build: verid:build → ${skill("build")}; the main agent writes tests and code under the TDD gate.`,
          `- TDD: verid:tdd → ${skill("tdd")}.`,
          ...(antigravity
            ? [
                `- Review/serve: verid:review → ${skill("review")}; invoke_subagent verid-reviewer${manifest.roles?.security ? ", then verid-security," : ""} with module/AC identifiers, plan/design paths and .verid/review/work.md from verid menu --commits --file; its final line is Verdict: pass or Verdict: fail. Reviewer mappings: ${agents("reviewer")}.`,
                "- Antigravity runs the verid-* agents; verid:* agents are Claude Code plugin entries.",
              ]
            : [
                `- Review/serve: verid:review → ${skill("review")}; spawn verid_reviewer, agent_type and fork_turns: "none"; send module/ACs, plan/design and .verid/review/work.md (verid menu --commits --file). Reviewer mappings: ${agents("reviewer")}.`,
                "- Codex spawns configured agents only; verid:* agents are Claude Code plugin entries.",
              ]),
        ]
      : [
          "- Research, then spec: verid:ba in the main conversation.",
          `- Design: verid:design → architect ${agents("architect")}.`,
          `- Plan: verid:plan → planner ${agents("planner")}.`,
          `- Build: verid:build → tester ${agents("tester")}, qa ${agents("qa")} for end-to-end tests, coder ${agents("coder")}; verid:tdd for each cycle, verid:debugging for unclear failures.`,
          `- Review/serve: verid:review → reviewer ${agents("reviewer")}${manifest.roles?.security ? `, then security reviewer ${agents("security")}` : ""}.`,
        ]),
    `- Bug or failing test: verid:debugging${single ? ` → ${skill("debugging")}` : ""} first, fix under verid:tdd, verify with verid taste.`,
    `- ClaudeKit skills: ${skillsRoot.replaceAll("\\", "/")}/`,
    "",
    "### Commands",
    "- Agent: verid taste (evidence), verid peek, verid menu, verid doctor.",
    "- Task start: verid context [module]",
    "- Developer terminal only: verid cook, upgrade, stock, order [module], serve <module>, garnish, halt, resume.",
    ...(planned(manifest)
      ? ["- Developer only: verid board; agents never select or reorder tasks."]
      : []),
    "",
    "### Files",
    "- .verid/docs/: developer inputs, read-only.",
    "- Session log .verid/log/<module>.md: read at startup; main appends after each AC.",
    "- Inputs: .verid/{manifest.yaml,research.md,spec.md,design.md,plan.md}; evidence/audit: .verid/.state/.",
    "- Advisory rules: .verid/rules/{git,architecture,workflow}.md; small commits.",
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
    "- For verid friction, main appends date, kind (friction/gap/bug), skill/code/command, problem and suggestion to .verid/feedback.md; helpers report to main. Never edit/remove entries or copy source, test output, transcripts or secrets. Project bugs belong elsewhere.",
    END,
  ].join("\n");
  return manifest.resources === "repo"
    ? rendered.replace(/\bverid:(?!begin\b|end\b)([a-z][a-z-]+)/g, "verid-$1")
    : rendered;
}
