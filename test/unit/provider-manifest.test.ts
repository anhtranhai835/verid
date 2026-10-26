import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseManifest, renderManifest } from "../../src/core/manifest.js";
import { upgradeManifestText } from "../../src/adapters/manifest.js";

const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };

describe("provider manifest", () => {
  it("lets Codex auto use only a reviewer while retaining the Claude split", () => {
    const rows = [
      { providers: ["codex"], roles: { reviewer: ["verid_reviewer"] }, ok: true },
      { providers: ["codex"], roles: {}, ok: false },
      { providers: ["claude-code"], roles: { reviewer: ["verid:reviewer"] }, ok: false },
      { providers: ["claude-code", "codex"], roles: { reviewer: ["verid_reviewer"] }, ok: false },
    ];
    for (const row of rows)
      expect(
        parseManifest({
          schemaVersion: 1,
          mode: "prep",
          drive: "auto",
          repos: [repo],
          providers: row.providers,
          roles: row.roles,
        }).ok,
      ).toBe(row.ok);
  });

  it("adds the Codex reviewer to an existing reviewer mapping during migration", async () => {
    const text = await upgradeManifestText(
      'schemaVersion: 1\nmode: prep\nproviders: [codex]\nroles:\n  reviewer: ["my:reviewer"] # preserve\nrepos:\n  - path: .\n    source_globs: [src/**]\n    test_globs: [test/**]\n',
      { tests: [], ignore: [], e2e: [], roles: null, dropTestCmd: false },
    );
    expect(parse(text).roles.reviewer).toEqual(["my:reviewer", "verid_reviewer"]);
    expect(text).toContain("# preserve");
  });
  it("defaults older manifests to Claude Code and empty additional allowlists", () => {
    const result = parseManifest({ schemaVersion: 1, mode: "prep", repos: [repo] });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect({
        providers: result.manifest.providers,
        skills: result.manifest.allowed_skills,
        agents: result.manifest.allowed_agents,
      }).toEqual({ providers: ["claude-code"], skills: [], agents: [] });
  });

  it("validates a nonempty distinct provider selection", () => {
    const rows = [
      { providers: ["claude-code"], ok: true },
      { providers: ["codex"], ok: true },
      { providers: ["claude-code", "codex"], ok: true },
      { providers: [], ok: false },
      { providers: ["cursor"], ok: false },
      { providers: ["codex", "codex"], ok: false },
      { providers: "codex", ok: false },
    ];
    for (const row of rows) {
      const result = parseManifest({
        schemaVersion: 1,
        mode: "prep",
        repos: [repo],
        providers: row.providers,
      });
      expect(result.ok, JSON.stringify(row.providers)).toBe(row.ok);
      if (!result.ok) expect(result.detail).toMatch(/^providers/);
    }
  });

  it("accepts exact skill names and namespace wildcards and exact agent types only", () => {
    const rows = [
      { allowed_skills: ["custom:run", "custom:*"], allowed_agents: ["general-purpose"], ok: true },
      { allowed_skills: [], allowed_agents: [], ok: true },
      { allowed_skills: ["*"], allowed_agents: [], ok: false },
      { allowed_skills: ["custom:ru*"], allowed_agents: [], ok: false },
      { allowed_skills: [""], allowed_agents: [], ok: false },
      { allowed_skills: [" custom:run"], allowed_agents: [], ok: false },
      { allowed_skills: [], allowed_agents: ["custom:*"], ok: false },
    ];
    for (const { ok, ...fields } of rows)
      expect(parseManifest({ schemaVersion: 1, mode: "prep", repos: [repo], ...fields }).ok).toBe(
        ok,
      );
  });

  it("renders provider choices and defaults for the developer to edit", () => {
    const rows = [
      { providers: undefined, expected: ["claude-code"] },
      { providers: ["claude-code", "codex"] as const, expected: ["claude-code", "codex"] },
    ];
    for (const row of rows) {
      const doc = parse(
        renderManifest("prep", repo, undefined, undefined, "monorepo", undefined, row.providers),
      );
      expect(doc.providers).toEqual(row.expected);
      expect(doc.allowed_skills).toEqual([]);
      expect(doc.allowed_agents).toEqual(["general-purpose"]);
    }
  });

  it("migrates absent provider fields while keeping comments and explicit selections", async () => {
    const rows = [
      { fields: "", providers: ["claude-code"], skills: [], agents: ["general-purpose"] },
      { fields: "allowed_agents: []\n", providers: ["claude-code"], skills: [], agents: [] },
      {
        fields: 'allowed_agents: ["custom:helper"]\n',
        providers: ["claude-code"],
        skills: [],
        agents: ["custom:helper"],
      },
      {
        fields:
          'providers: [codex]\nallowed_skills: ["custom:*"]\nallowed_agents: [general-purpose]\n',
        providers: ["codex"],
        skills: ["custom:*"],
        agents: ["general-purpose"],
      },
    ];
    for (const row of rows) {
      const text = await upgradeManifestText(
        `# keep this\nschemaVersion: 1\nmode: prep\n${row.fields}repos:\n  - path: .\n    source_globs: [src/**]\n    test_globs: [test/**]\n`,
        { tests: [], ignore: [], e2e: [], roles: null, dropTestCmd: false },
      );
      const doc = parse(text);
      expect(text).toContain("# keep this");
      expect(doc.providers).toEqual(row.providers);
      expect(doc.allowed_skills).toEqual(row.skills);
      expect(doc.allowed_agents).toEqual(row.agents);
    }
  });
});
