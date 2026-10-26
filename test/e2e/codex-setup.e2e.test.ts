import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const CLI = join(import.meta.dirname, "../../dist/cli.js");
let dir: string;
let project: string;
let home: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "verid codex setup "));
  project = join(dir, "project with spaces");
  home = join(dir, "codex home");
  mkdirSync(project);
  mkdirSync(home);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const cliAt = (entry: string, ...args: string[]) =>
  spawnSync(process.execPath, [entry, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(CLAUDE|CODEX)/.test(key)),
      ),
      CODEX_HOME: home,
    },
  });
const cli = (...args: string[]) => cliAt(CLI, ...args);
const read = (path: string) => readFileSync(path, "utf8");

describe("Codex setup and diagnostics", () => {
  it("checks the installed reviewer overlay rather than only its config mapping", () => {
    const install = join(dir, "isolated install");
    const root = join(import.meta.dirname, "../..");
    for (const name of ["dist", "plugin", "i18n"])
      cpSync(join(root, name), join(install, name), { recursive: true });
    writeFileSync(join(install, "package.json"), '{"type":"module"}');
    const entry = join(install, "dist/cli.js");
    expect(cliAt(entry, "cook", "--yes", "--provider", "codex").status).toBe(0);
    const overlay = join(install, "dist/codex-reviewer.toml");
    const rows = ["missing", "edited"];
    for (const kind of rows) {
      if (kind === "missing") rmSync(overlay);
      else writeFileSync(overlay, 'model = "other"\n');
      const r = cliAt(entry, "doctor");
      expect(r.stdout, kind).toContain("! codex.reviewer:");
    }
  });
  it("recognizes Codex hook wiring in the peek CLI", () => {
    expect(cli("cook", "--yes", "--provider", "codex").status).toBe(0);
    const result = cli("peek");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
  it("registers the machine reviewer without creating a project", () => {
    const result = cli("setup-codex");
    expect(result.status, result.stderr).toBe(0);
    expect(read(join(home, "config.toml"))).toContain("[agents.verid_reviewer]");
    expect(existsSync(join(project, ".verid"))).toBe(false);
    expect(existsSync(join(project, ".codex"))).toBe(false);
  });
  it("previews machine configuration without writing and merges user hook and TOML settings", () => {
    const config = join(home, "config.toml");
    writeFileSync(config, '# keep\r\nmodel = "mine"\r\n');
    mkdirSync(join(project, ".codex"));
    writeFileSync(
      join(project, ".codex/hooks.json"),
      JSON.stringify({
        custom: 123,
        hooks: { Stop: [{ hooks: [{ type: "command", command: "user" }] }] },
      }),
    );
    const preview = cli("cook", "--yes", "--provider", "codex", "--dry-run");
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain("~ hooks.json");
    expect(preview.stdout).toContain("~ config.toml");
    expect(read(config)).toBe('# keep\r\nmodel = "mine"\r\n');
    expect(existsSync(join(project, ".verid"))).toBe(false);
    const setup = cli("cook", "--yes", "--provider", "codex");
    expect(setup.status, setup.stderr).toBe(0);
    expect(read(config)).toContain('# keep\r\nmodel = "mine"\r\n');
    expect(read(config)).toContain("[agents.verid_reviewer]");
    const hooks = JSON.parse(read(join(project, ".codex/hooks.json")));
    expect(hooks.custom).toBe(123);
    expect(hooks.hooks.Stop[0].hooks[0].command).toBe("user");
    const upgrade = cli("upgrade", "--yes");
    expect(upgrade.status, upgrade.stderr).toBe(0);
    expect(upgrade.stdout).toContain("= hooks.json");
    expect(upgrade.stdout).toContain("= config.toml");
  });

  it("migrates Codex reviewer roles and replaces stale hook wiring", () => {
    mkdirSync(join(project, ".verid"));
    writeFileSync(
      join(project, ".verid/manifest.yaml"),
      '# keep\nschemaVersion: 1\nmode: prep\nproviders: [codex]\nroles:\n  reviewer: ["custom:reviewer"]\nrepos:\n  - path: .\n    source_globs: [src/**]\n    test_globs: [test/**]\n',
    );
    const upgrade = cli("upgrade", "--yes");
    expect(upgrade.status, upgrade.stderr).toBe(0);
    expect(parse(read(join(project, ".verid/manifest.yaml"))).roles.reviewer).toEqual([
      "custom:reviewer",
      "verid_reviewer",
    ]);
    expect(read(join(project, ".verid/manifest.yaml"))).toContain("# keep");
    expect(read(join(project, "AGENTS.md"))).toContain("/plugin/skills/build/SKILL.md");
  });

  it("reports missing Codex trust and reviewer configuration without repairing anything", () => {
    const setup = cli("cook", "--yes", "--provider", "codex");
    expect(setup.status, setup.stderr).toBe(0);
    writeFileSync(join(home, "config.toml"), "# user\n");
    const before = read(join(home, "config.toml"));
    const result = cli("doctor");
    expect(result.status, result.stderr + result.stdout).toBe(1);
    expect(result.stdout).toContain("! codex.project_trust:");
    expect(result.stdout).toContain("! codex.hook_trust:");
    expect(result.stdout).toContain("! codex.reviewer:");
    expect(result.stdout).toContain("/hooks");
    expect(read(join(home, "config.toml"))).toBe(before);
  });
});
