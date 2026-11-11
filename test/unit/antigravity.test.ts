import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { hostFor } from "../../src/adapters/host.js";
import { instructionBlocks } from "../../src/core/instructions.js";
import {
  defaultRoles,
  parseManifest,
  resourceRoles,
  singleWriterOnly,
  type Manifest,
} from "../../src/core/manifest.js";

const PRESETS = join(import.meta.dirname, "../../plugin/antigravity/presets");
const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };

describe("Antigravity provider", () => {
  it("ships presets verid accepts as manifests", () => {
    const files = readdirSync(PRESETS).filter((f) => f.endsWith(".yaml"));
    expect(files).toHaveLength(3);
    for (const file of files) {
      const parsed = parseManifest(parse(readFileSync(join(PRESETS, file), "utf8")));
      expect(parsed, file).toMatchObject({ ok: true });
      if (parsed.ok) expect(parsed.manifest.providers).toEqual(["antigravity"]);
    }
  });

  it("maps the plugin's read-only agents, also in a repo copy, and writes with main", () => {
    expect(defaultRoles(["antigravity"])).toMatchObject({
      reviewer: ["verid:reviewer", "verid-reviewer"],
      security: ["verid:security", "verid-security"],
    });
    expect(resourceRoles(defaultRoles(["antigravity"]), "repo")).toMatchObject({
      reviewer: ["verid-reviewer"],
      security: ["verid-security"],
    });
    // Codex alone keeps no security agent; with Antigravity it does.
    expect(defaultRoles(["codex"]).security).toBeUndefined();
    expect(defaultRoles(["codex", "antigravity"]).reviewer).toEqual([
      "verid:reviewer",
      "verid_reviewer",
      "verid-reviewer",
    ]);
    expect(singleWriterOnly(["antigravity"])).toBe(true);
    expect(singleWriterOnly(["codex", "antigravity"])).toBe(true);
    expect(singleWriterOnly(["claude-code", "antigravity"])).toBe(false);
  });

  it("writes one AGENTS.md block that labels what only some providers need", () => {
    const manifest = (providers: Manifest["providers"]) => {
      const parsed = parseManifest({ schemaVersion: 1, mode: "prep", providers, repos: [repo] });
      if (!parsed.ok) throw new Error(parsed.detail);
      return { ...parsed.manifest, roles: defaultRoles(providers) };
    };
    const [alone] = instructionBlocks(manifest(["antigravity"]));
    expect(alone!.block).toContain("invoke_subagent verid-reviewer, then verid-security,");
    expect(alone!.block).toContain("typed in the Antigravity chat");
    expect(alone!.block).not.toMatch(/\(Antigravity\)|\(Codex\)/);
    const all = instructionBlocks(manifest(["antigravity", "codex", "claude-code"]));
    expect(all.map((b) => b.file)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    const block = all[0]!.block;
    expect(block).toContain("- (Antigravity) Antigravity hooks enforce TDD");
    expect(block).toContain("- (Codex) Codex hooks enforce TDD");
    expect(block).toContain("- (Claude Code) Claude Code hooks enforce TDD");
    // Shared by the two single-writer hosts, labelled with both.
    expect(block).toContain("- (Codex, Antigravity) Call the installed skills by absolute path");
    // Every provider's line once, unlabelled.
    expect(block.match(/- Never bypass a denial/g)).toHaveLength(1);
    // The order providers are listed in does not change the block.
    expect(instructionBlocks(manifest(["claude-code", "codex", "antigravity"]))[0]!.block).toBe(
      block,
    );
  });

  it("is chosen only by an explicit argument that names its event", () => {
    expect(hostFor(["--provider", "antigravity", "--event", "PreToolUse"])).toMatchObject({
      host: { id: "antigravity", singleWriter: true, event: "PreToolUse" },
    });
    expect(hostFor(["--provider", "antigravity", "--event", "PreInvocation"]).host.event).toBe(
      "UserPromptSubmit",
    );
    expect(hostFor(["--provider", "antigravity"]).error?.code).toBe("VERID_BURNT_PAYLOAD");
    expect(hostFor(["--provider", "codex"]).host.id).toBe("codex");
    expect(hostFor([]).host.id).toBe("claude-code");
    expect(hostFor(["--provider", "cursor"]).error?.code).toBe("VERID_BURNT_PAYLOAD");
  });
});
