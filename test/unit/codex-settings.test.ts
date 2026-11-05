import { describe, expect, it } from "vitest";
import {
  withCodexHooks,
  hasCurrentCodexHooks,
  mergeCodexReviewer,
  codexTrust,
  hasCodexReviewer,
  installedSkills,
  reviewerContent,
} from "../../src/adapters/codex-settings.js";

describe("Codex configuration", () => {
  it("merges marked hooks with explicit provider and platform commands", () => {
    const old = {
      custom: true,
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "user" }] }] },
    };
    const result = withCodexHooks(
      old,
      "C:/install with spaces/dist/hook.js",
      "C:/node folder/node.exe",
    );
    expect(result.settings.custom).toBe(true);
    expect(
      hasCurrentCodexHooks(
        result.settings,
        "C:/install with spaces/dist/hook.js",
        "C:/node folder/node.exe",
      ),
    ).toBe(true);
    const hooks = result.settings.hooks as Record<string, { hooks: Record<string, unknown>[] }[]>;
    expect(hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe("user");
    expect(hooks.PreToolUse?.[1]?.hooks[0]).toEqual({
      type: "command",
      command: '"C:/node folder/node.exe" "C:/install with spaces/dist/hook.js" --provider codex',
      commandWindows:
        '& "C:/node folder/node.exe" "C:/install with spaces/dist/hook.js" --provider codex',
      timeout: 10,
      statusMessage: "verid",
    });
    expect(
      withCodexHooks(
        result.settings,
        "C:/install with spaces/dist/hook.js",
        "C:/node folder/node.exe",
      ).changed,
    ).toBe(false);
    expect(JSON.stringify(result.settings)).not.toContain("bypass");
  });

  it("keeps every user TOML byte outside the marked reviewer block", () => {
    const old =
      '# user\r\nmodel = "mine"\r\n[projects."C:/project"]\r\ntrust_level = "trusted"\r\n';
    const result = mergeCodexReviewer(old, "C:/install/reviewer.toml");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.detail);
    expect(result.content.startsWith(old)).toBe(true);
    expect(result.content).toContain(
      '[agents.verid_reviewer]\r\ndescription = "Read-only review of verid acceptance criteria and the diff"\r\nconfig_file = "C:/install/reviewer.toml"',
    );
    expect(mergeCodexReviewer(result.content, "C:/install/reviewer.toml")).toEqual(result);
    const rows = [
      '[agents.verid_reviewer]\nconfig_file = "user"\n',
      "# verid:begin\n",
      "# verid:end\n",
    ];
    for (const text of rows) expect(mergeCodexReviewer(text, "overlay").ok).toBe(false);
  });

  it("quotes literal shell metacharacters in installation paths", () => {
    const result = withCodexHooks({}, "C:/user $data`/dist/hook.js", "C:/node.exe");
    const hooks = result.settings.hooks as Record<string, { hooks: Record<string, unknown>[] }[]>;
    expect(hooks.Stop?.[0]?.hooks[0]?.commandWindows).toBe(
      '& "C:/node.exe" "C:/user `$data``/dist/hook.js" --provider codex',
    );
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toBe(
      '"C:/node.exe" "C:/user \\$data\\`/dist/hook.js" --provider codex',
    );
  });

  it("keeps marker and table text inside user TOML strings as user content", () => {
    const rows = [
      'note = "# verid:begin"\n',
      'note = """\n# verid:begin\n[agents.verid_reviewer]\nconfig_file = "mine"\n# verid:end\n"""\n',
      "note = '''\n# verid:begin\n[agents.verid_reviewer]\n# verid:end\n'''\n",
      '["agents.verid_reviewer"]\nconfig_file = "mine"\n',
    ];
    for (const old of rows) {
      const result = mergeCodexReviewer(old, "C:/install/reviewer.toml");
      expect(result.ok, old).toBe(true);
      if (!result.ok) throw new Error(result.detail);
      expect(result.content.startsWith(old), old).toBe(true);
      expect(hasCodexReviewer(result.content, "C:/install/reviewer.toml")).toBe(true);
    }
  });

  it("refuses an unmarked reviewer declared through any TOML key form", () => {
    const rows = [
      'agents.verid_reviewer = { config_file = "mine" }\n',
      '[agents]\nverid_reviewer = { config_file = "mine" }\n',
      '[agents.verid_reviewer.extra]\nvalue = "mine"\n',
      '[agents."verid_reviewer"]\nconfig_file = "mine"\n',
    ];
    for (const text of rows) expect(mergeCodexReviewer(text, "overlay").ok, text).toBe(false);
  });

  it("does not accept reviewer or trust entries inside TOML multiline strings", () => {
    const text =
      'note = """\n[agents.verid_reviewer]\ndescription = "mine"\nconfig_file = "overlay"\n[projects."C:/project"]\ntrust_level = "trusted"\n[hooks.state."C:/project/.codex/hooks.json:pre_tool_use:0:0"]\ntrusted_hash = "sha256:abc"\n"""\n';
    expect(hasCodexReviewer(text, "overlay")).toBe(false);
    expect(
      codexTrust(text, "C:/project", ["C:/project/.codex/hooks.json:pre_tool_use:0:0"]),
    ).toEqual({
      project: false,
      hooks: false,
    });
  });

  it("requires project trust and a trusted hash for every registered verid handler", () => {
    const rows = [
      {
        text: '[projects."C:/project"]\ntrust_level = "trusted"\n[hooks.state."C:/project/.codex/hooks.json:pre_tool_use:0:0"]\ntrusted_hash = "sha256:abc"\n',
        project: true,
        hooks: true,
      },
      { text: '[projects."C:/other"]\ntrust_level = "trusted"\n', project: false, hooks: false },
      {
        text: '[projects."C:/project"]\ntrust_level = "untrusted"\n',
        project: false,
        hooks: false,
      },
    ];
    for (const row of rows)
      expect(
        codexTrust(row.text, "C:/project", ["C:/project/.codex/hooks.json:pre_tool_use:0:0"]),
      ).toEqual({ project: row.project, hooks: row.hooks });
  });
  // Codex maps no security role: its one reviewer checks security as verid:security says.
  it("points the Codex reviewer at the review and security skills it reads by path", () => {
    const skills = installedSkills().replaceAll("\\", "/");
    const text = reviewerContent();
    const rows = [
      [`${skills}/review/SKILL.md`, true],
      [`${skills}/security/SKILL.md`, true],
      ["Verdict: pass or Verdict: fail", true],
      ["{{", false],
    ] as const;
    for (const [part, present] of rows) expect(text.includes(part), part).toBe(present);
  });
});
