import { describe, expect, it } from "vitest";
import {
  instructionBlock,
  instructionFile,
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

  it("names each provider file and keeps workflow references short with the effective allowlists", () => {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      allowed_skills: ["tools:allowed", "custom:*"],
      allowed_agents: ["custom:extra"],
      roles: {
        tester: ["custom:tester"],
        coder: ["custom:coder"],
        reviewer: ["custom:reviewer"],
        researcher: ["custom:researcher"],
        security: ["custom:security"],
      },
      repos: [{ path: ".", source_globs: ["**"], test_globs: ["**/*.test.ts"] }],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    const rows = [
      { provider: "claude-code", file: "CLAUDE.md", notice: "Claude Code hooks enforce" },
      {
        provider: "codex",
        file: "AGENTS.md",
        notice: "Codex hooks enforce",
      },
    ] as const;
    for (const { provider, file, notice } of rows) {
      expect(instructionFile(provider)).toBe(file);
      const text = renderInstructions(parsed.manifest, provider, "C:/install/plugin/skills");
      expect(text).toContain(notice);
      expect(text).toContain("verid:design");
      if (provider === "claude-code") expect(text).toContain("custom:researcher");
      expect(text).toContain("verid:plan");
      expect(text).toContain("verid:build");
      if (provider === "claude-code") {
        expect(text).toContain("custom:tester");
        expect(text).toContain("custom:coder");
        expect(text).toContain("security reviewer custom:security");
      }
      expect(text).toContain("verid:review");
      expect(text).toContain("custom:reviewer");
      expect(text).toContain(
        "Skill allowlist: verid:*; superpowers:*; andrej-karpathy-skills:*; tools:allowed; custom:*.",
      );
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
      expect(text.split("\n").length).toBeLessThan(25);
    }
  });
});
