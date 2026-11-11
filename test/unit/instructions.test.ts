import { describe, expect, it } from "vitest";
import {
  instructionBlock,
  instructionBlocks,
  mergeInstructions,
  renderInstructions,
} from "../../src/core/instructions.js";
import { parseManifest } from "../../src/core/manifest.js";

const block = "<!-- verid:begin -->\nnew instructions\n<!-- verid:end -->";

describe("provider instruction blocks", () => {
  it("inserts or updates only the marked block and preserves every outside byte", () => {
    const rows = [
      { old: undefined, want: "<!-- verid:begin -->\nnew instructions\n<!-- verid:end -->\n" },
      { old: "", want: "<!-- verid:begin -->\nnew instructions\n<!-- verid:end -->\n" },
      {
        old: "user text",
        want: "user text\n\n<!-- verid:begin -->\nnew instructions\n<!-- verid:end -->\n",
      },
      {
        old: "user text\r\n",
        want: "user text\r\n\r\n<!-- verid:begin -->\r\nnew instructions\r\n<!-- verid:end -->\r\n",
      },
      {
        old: "before\r\n<!-- verid:begin -->\r\nold\r\n<!-- verid:end -->\r\nafter\r\n",
        want: "before\r\n<!-- verid:begin -->\r\nnew instructions\r\n<!-- verid:end -->\r\nafter\r\n",
      },
      {
        old: "<!-- verid:begin -->\nnew instructions\n<!-- verid:end -->\n",
        want: "<!-- verid:begin -->\nnew instructions\n<!-- verid:end -->\n",
      },
      {
        old: "before\r\n<!-- verid:begin -->\r\nnew instructions\r\n<!-- verid:end -->\r\nafter\r\n",
        want: "before\r\n<!-- verid:begin -->\r\nnew instructions\r\n<!-- verid:end -->\r\nafter\r\n",
      },
    ];
    for (const { old, want } of rows)
      expect(mergeInstructions(old, block)).toEqual({ ok: true, content: want });
  });

  it("refuses ambiguous markers without dropping the user's content", () => {
    const rows = [
      "before\n<!-- verid:begin -->\nold",
      "<!-- verid:end -->\nuser text",
      "<!-- verid:end -->\n<!-- verid:begin -->",
      "<!-- verid:begin --><!-- verid:begin --><!-- verid:end -->",
      "<!-- verid:begin --><!-- verid:end --><!-- verid:begin --><!-- verid:end -->",
    ];
    for (const old of rows) {
      expect(mergeInstructions(old, block)).toEqual({
        ok: false,
        detail: "expected one ordered verid:begin/verid:end marker pair",
      });
      expect(instructionBlock(old)).toEqual({
        ok: false,
        detail: "expected one ordered verid:begin/verid:end marker pair",
      });
    }
  });

  it("extracts the exact protected block independently of user content", () => {
    const rows = [
      { text: "user content", want: null },
      {
        text: "before\n<!-- verid:begin -->\r\ninstructions\r\n<!-- verid:end -->\nafter",
        want: "<!-- verid:begin -->\r\ninstructions\r\n<!-- verid:end -->",
      },
    ];
    for (const { text, want } of rows)
      expect(instructionBlock(text)).toEqual({ ok: true, block: want });
  });

  it("keeps workflow references short with the effective allowlists", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      allowed_skills: ["tools:allowed", "custom:*"],
      allowed_agents: ["custom:extra"],
      roles: {
        tester: ["custom:tester"],
        coder: ["custom:coder"],
        reviewer: ["custom:reviewer"],
        architect: ["custom:architect"],
        security: ["custom:security"],
      },
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    const rows = [
      { provider: "claude-code", notice: "Claude Code hooks enforce" },
      { provider: "codex", notice: "Codex hooks enforce" },
    ] as const;
    for (const { provider, notice } of rows) {
      const text = renderInstructions(parsed.manifest, provider, "C:/install/plugin/skills");
      expect(text).toContain(notice);
      expect(text).toContain("verid:design");
      if (provider === "claude-code") expect(text).toContain("custom:architect");
      expect(text).toContain("verid:plan");
      expect(text).toContain("verid:build");
      if (provider === "claude-code") {
        expect(text).toContain("custom:tester");
        expect(text).toContain("custom:coder");
        expect(text).toContain("security reviewer custom:security");
      }
      expect(text).toContain("verid:review");
      expect(text).toContain("custom:reviewer");
      expect(text).toContain("- Known skills: verid:*; tools:allowed; custom:*.");
      expect(text).toContain("custom:extra");
      expect(text).toContain(".verid/.state/");
      expect(text).toContain("verid taste");
      expect(text).toContain("Only the developer");
      if (provider === "codex") {
        expect(text).toContain("C:/install/plugin/skills/build/SKILL.md");
        expect(text).toContain("main agent writes tests and code");
        expect(text).toContain("exceptions require Claude Code");
        expect(text).toContain("Advisory");
      }
      expect(text.length, provider).toBeLessThan(3400);
    }
  });

  it("puts hard rules first and groups the rest under fixed headings", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    const rows = [
      { provider: "claude-code", first: "- Claude Code hooks enforce" },
      { provider: "codex", first: "- Codex hooks enforce" },
    ] as const;
    for (const { provider, first } of rows) {
      const lines = renderInstructions(parsed.manifest, provider).split("\n");
      expect(lines.filter((line) => line.startsWith("#"))).toEqual([
        "## verid",
        "### Rules",
        "### TDD cycle",
        "### Workflow",
        "### Commands",
        "### Files",
        "### Feedback on verid",
      ]);
      expect(lines[lines.indexOf("### Rules") + 1]).toMatch(new RegExp(`^${first}`));
      expect(lines).toContain("- Never bypass a denial; follow its reason.");
    }
  });

  it("explains each TDD state and which commands belong to the agent or the developer", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    for (const provider of ["claude-code", "codex"] as const) {
      const lines = renderInstructions(parsed.manifest, provider).split("\n");
      for (const line of [
        "- RAW: code locked; write a failing test, then verid taste.",
        "- COOKING: tests frozen; implement, then verid taste.",
        "- PLATED: refactor passing code; new behaviour starts RAW.",
        "- .verid/docs/: developer inputs, read-only.",
        "- Session log .verid/log/<module>.md: read at startup; main appends after each AC.",
        "- Inputs: .verid/{manifest.yaml,research.md,spec.md,design.md,plan.md}; evidence/audit: .verid/.state/.",
        "- Agent: verid taste (evidence), verid peek, verid menu, verid doctor.",
        "- Developer terminal only: verid cook, upgrade, stock, order [module], serve <module>, garnish, halt, resume.",
      ])
        expect(lines, provider).toContain(line);
    }
  });

  it("sends a bug or failing test to the debugging skill before the TDD cycle", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    for (const provider of ["claude-code", "codex", "antigravity"] as const) {
      const text = renderInstructions(parsed.manifest, provider);
      const path = provider === "claude-code" ? "" : " → plugin/skills/debugging/SKILL.md";
      expect(text, provider).toContain(
        `- Bug or failing test: verid:debugging${path} first, fix under verid:tdd, verify with verid taste.`,
      );
      expect(text, provider).not.toContain("Debugging: verid:tdd");
    }
    const repo = renderInstructions({ ...parsed.manifest, resources: "repo" }, "claude-code");
    expect(repo).toContain("Bug or failing test: verid-debugging first, fix under verid-tdd");
  });

  it("sends a new developer or workspace to the read-only onboard skill", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(
      (["claude-code", "codex"] as const).map((provider) =>
        renderInstructions(parsed.manifest, provider)
          .split("\n")
          .find((line) => line.includes("verid:onboard")),
      ),
    ).toEqual([
      "- Onboarding: verid:onboard; read-only health/status.",
      "- Onboarding: verid:onboard → plugin/skills/onboard/SKILL.md; read-only health/status.",
    ]);
  });

  it("lists the allowlists only when the manifest adds skills or agents to them", () => {
    const rows = [
      { extra: {}, want: false },
      { extra: { allowed_skills: ["tools:x"] }, want: true },
      { extra: { allowed_agents: ["custom:extra"] }, want: true },
    ];
    for (const { extra, want } of rows) {
      const parsed = parseManifest({
        schemaVersion: 1,
        mode: "prep",
        roles: { reviewer: ["verid:reviewer"], tester: ["verid:tester"], coder: ["verid:coder"] },
        ...extra,
        repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
      });
      if (!parsed.ok) throw new Error(parsed.detail);
      for (const provider of ["claude-code", "codex"] as const)
        expect(
          renderInstructions(parsed.manifest, provider).includes("### Allowlists (audit)"),
          `${provider} ${JSON.stringify(extra)}`,
        ).toBe(want);
    }
  });

  it("keeps the block in AGENTS.md for every provider, and has CLAUDE.md import it", () => {
    const manifestFor = (providers: string[]) => {
      const parsed = parseManifest({
        schemaVersion: 1,
        mode: "prep",
        providers,
        repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
      });
      if (!parsed.ok) throw new Error(parsed.detail);
      return parsed.manifest;
    };
    const imported = "<!-- verid:begin -->\n@AGENTS.md\n<!-- verid:end -->";
    const claude = manifestFor(["claude-code"]);
    const codex = manifestFor(["codex"]);
    expect(instructionBlocks(claude, "S")).toEqual([
      { file: "AGENTS.md", block: renderInstructions(claude, "claude-code", "S") },
      { file: "CLAUDE.md", block: imported },
    ]);
    expect(instructionBlocks(codex, "S")).toEqual([
      { file: "AGENTS.md", block: renderInstructions(codex, "codex", "S") },
    ]);
    const both = instructionBlocks(manifestFor(["claude-code", "codex"]), "S");
    expect(both.map((b) => b.file)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(both[1]!.block).toBe(imported);
    const lines = both[0]!.block.split("\n");
    for (const line of [
      "- Never bypass a denial; follow its reason.",
      "- (Claude Code) Research, then spec: verid:ba in the main conversation.",
      "- (Codex) Research/spec: verid:ba → S/ba/SKILL.md.",
    ])
      expect(
        lines.filter((l) => l === line),
        line,
      ).toHaveLength(1);
    expect(lines.filter((l) => l === "### Workflow")).toHaveLength(1);
  });

  it("tells Codex that Claude Code plugin agents cannot be spawned there", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    const note =
      "- Codex spawns configured agents only; verid:* agents are Claude Code plugin entries.";
    expect(
      (["claude-code", "codex"] as const).map((provider) =>
        renderInstructions(parsed.manifest, provider).split("\n").includes(note),
      ),
    ).toEqual([false, true]);
  });

  it("gives the main thread alone a scoped, append-only verid feedback log", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    const line =
      "- For verid friction, main appends date, kind (friction/gap/bug), skill/code/command, problem and suggestion to .verid/feedback.md; helpers report to main. Never edit/remove entries or copy source, test output, transcripts or secrets. Project bugs belong elsewhere.";
    expect(
      (["claude-code", "codex"] as const).map((provider) =>
        renderInstructions(parsed.manifest, provider).split("\n").includes(line),
      ),
    ).toEqual([true, true]);
  });
});
