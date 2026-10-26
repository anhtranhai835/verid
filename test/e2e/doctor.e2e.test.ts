import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { codexHookKeys } from "../../src/adapters/codex-settings.js";

const root = join(import.meta.dirname, "../..");
const CLI = join(root, "dist/cli.js");
let dir: string;
let project: string;
let config: string;
let fixture: string;
let fixtureDir: string;
let sequence = 0;
beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "verid-doctor-fixture-"));
  dir = fixtureDir;
  config = join(dir, "claude-config");
  createHealthy();
  fixture = project;
});
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "verid-doctor-"));
  config = join(dir, "claude-config");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const env = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE"))),
  CLAUDE_CONFIG_DIR: config,
  CODEX_HOME: join(dir, "codex"),
});
const cli = (args: string[], extra = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: { ...env(), ...extra },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: project, env: env(), encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
};
const commit = () => {
  git("add", ".");
  git(
    "-c",
    "user.name=Verid test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--no-verify",
    "-qm",
    "fixture",
  );
};
const manifest = (edit: (m: any) => void) => {
  const path = join(project, ".verid/manifest.yaml");
  const doc = parse(readFileSync(path, "utf8"));
  edit(doc);
  writeFileSync(path, stringify(doc));
};
const plugins = (entries: Record<string, unknown>) =>
  put(
    join(config, "plugins/installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: entries }),
  );
const createHealthy = () => {
  project = join(dir, `project-${sequence++}`);
  mkdirSync(project);
  put(join(project, "package.json"), '{"devDependencies":{"vitest":"^5.0.0"}}');
  expect(cli(["cook", "--yes", "--lang", "en"]).code).toBe(0);
  manifest((m) => {
    m.repos[0].default_branch = "main";
  });
  git("init", "-q", "-b", "main");
  commit();
  const installPath = join(config, "cache/plugins");
  mkdirSync(installPath, { recursive: true });
  plugins({
    "superpowers@claude-plugins-official": [{ scope: "user", installPath }],
    "andrej-karpathy-skills@karpathy-skills": [{ scope: "user", installPath }],
    "verid@verid": [{ scope: "user", installPath }],
  });
};
const healthy = () => {
  project = join(dir, "project");
  rmSync(project, { recursive: true, force: true });
  cpSync(fixture, project, { recursive: true });
  plugins({
    "superpowers@claude-plugins-official": [{ scope: "user", installPath: config }],
    "andrej-karpathy-skills@karpathy-skills": [{ scope: "user", installPath: config }],
    "verid@verid": [{ scope: "user", installPath: config }],
  });
};
const snapshot = () =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => [join(e.parentPath, e.name), readFileSync(join(e.parentPath, e.name), "hex")]);
const trustCodex = () => {
  const file = join(project, ".codex", "hooks.json");
  const configFile = join(dir, "codex", "config.toml");
  const keys = codexHookKeys(
    JSON.parse(readFileSync(file, "utf8")),
    file,
    join(root, "dist", "hook.js"),
  );
  put(
    configFile,
    readFileSync(configFile, "utf8") +
      `\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n` +
      keys
        .map((key) => `[hooks.state.${JSON.stringify(key)}]\ntrusted_hash = "sha256:abc"\n`)
        .join(""),
  );
};

describe("verid doctor", () => {
  it("reports intact LF and CRLF instruction blocks as current for both providers", () => {
    const rows = [{ ending: "\n" }, { ending: "\r\n" }];
    for (const { ending } of rows) {
      healthy();
      manifest((m) => {
        m.providers = ["claude-code", "codex"];
      });
      expect(cli(["upgrade", "--yes"]).code).toBe(0);
      trustCodex();
      for (const file of ["CLAUDE.md", "AGENTS.md"]) {
        const path = join(project, file);
        put(path, readFileSync(path, "utf8").replaceAll("\r\n", "\n").replaceAll("\n", ending));
      }
      commit();
      const before = snapshot();
      const result = cli(["doctor"]);
      expect(result.code, result.err + result.out).toBe(0);
      expect(result.out).toContain("CLAUDE.md: verid instruction block is current");
      expect(result.out).toContain("AGENTS.md: verid instruction block is current");
      expect(snapshot()).toEqual(before);
    }
  });
  it("reports missing and edited managed instructions without changing the file", () => {
    const rows = [
      { content: null },
      { content: "developer text\n<!-- verid:begin -->\nedited\n<!-- verid:end -->\n" },
    ];
    for (const row of rows) {
      healthy();
      const file = join(project, "CLAUDE.md");
      if (row.content === null) rmSync(file, { force: true });
      else put(file, row.content);
      const before = snapshot();
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(1);
      expect(r.out).toContain("! instructions.claude-code:");
      expect(r.out).toContain("CLAUDE.md");
      expect(r.out).toContain("upgrade");
      expect(snapshot()).toEqual(before);
    }
  });

  it("checks each selected provider and accepts user edits outside the block", () => {
    healthy();
    manifest((m) => {
      m.providers = ["claude-code", "codex"];
    });
    expect(cli(["upgrade", "--yes"]).code).toBe(0);
    trustCodex();
    const rows = [
      { file: "CLAUDE.md", finding: "! instructions.claude-code:" },
      { file: "AGENTS.md", finding: "! instructions.codex:" },
    ];
    for (const { file } of rows) {
      const path = join(project, file);
      put(path, `user prefix\r\n${readFileSync(path, "utf8")}user suffix\r\n`);
    }
    commit();
    expect(cli(["doctor"]).code).toBe(0);
    for (const { file, finding } of rows) {
      const path = join(project, file);
      const text = readFileSync(path, "utf8");
      const cases = [
        { content: null },
        { content: text.replace("## verid", "## changed") },
        { content: "<!-- verid:begin -->\nbroken" },
      ];
      for (const { content } of cases) {
        if (content === null) rmSync(path);
        else put(path, content);
        const before = snapshot();
        const result = cli(["doctor"]);
        expect(result.code, result.err + result.out).toBe(1);
        expect(result.out).toContain(finding);
        expect(result.out).toContain(file);
        expect(snapshot()).toEqual(before);
        put(path, text);
      }
    }
  }, 60_000); // eight doctor runs, each asking Codex for its version: slow on a busy machine

  it("does not require Claude wiring for a Codex-only project's instruction check", () => {
    healthy();
    manifest((m) => {
      m.providers = ["codex"];
    });
    expect(cli(["upgrade", "--yes"]).code).toBe(0);
    trustCodex();
    rmSync(join(project, ".claude"), { recursive: true, force: true });
    rmSync(join(config, "plugins/installed_plugins.json"));
    commit();
    const before = snapshot();
    const result = cli(["doctor"]);
    expect(result.code, result.err + result.out).toBe(0);
    expect(result.out).toContain("AGENTS.md: verid instruction block is current");
    expect(result.out).toContain("Codex hooks point at this install");
    expect(result.out).not.toContain("! hooks:");
    expect(result.out).not.toContain("! plugin.");
    expect(snapshot()).toEqual(before);
  });

  it("reports a healthy project with exit zero, also inside Claude Code, without writes", () => {
    healthy();
    const before = snapshot();
    const r = cli(["doctor"], { CLAUDECODE: "1" });
    expect(r.code, r.err + r.out).toBe(0);
    expect(r.out).toContain("No problems found.");
    expect(snapshot()).toEqual(before);
  });

  it("reports every repo problem with a fix and exits one", () => {
    const rows = [
      { kind: "folder", want: ["repo.folder"] },
      { kind: "git", want: ["repo.git"] },
      { kind: "dirty", want: ["repo.dirty"] },
      { kind: "branch", want: ["repo.branch"] },
      { kind: "runner", want: ["repo.runner"] },
      { kind: "combined", want: ["repo.dirty", "repo.branch", "repo.runner"] },
    ];
    for (const row of rows) {
      healthy();
      if (row.kind === "folder") {
        manifest((m) => {
          m.repos[0].path = "missing";
        });
      }
      if (row.kind === "git") rmSync(join(project, ".git"), { recursive: true, force: true });
      if (["runner", "combined"].includes(row.kind)) {
        put(join(project, "package.json"), "{}");
        git(
          "-c",
          "user.name=Verid test",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "--no-verify",
          "-qam",
          "runner fixture",
        );
      }
      if (["branch", "combined"].includes(row.kind)) git("checkout", "-qb", "feature");
      if (["dirty", "combined"].includes(row.kind)) put(join(project, "uncommitted.txt"), "change");
      const before = snapshot();
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(1);
      for (const want of row.want) expect(r.out).toContain(`! ${want}`);
      for (const line of r.out.split("\n").filter((s) => s.startsWith("!")))
        expect(line).toContain("Fix:");
      expect(snapshot()).toEqual(before);
    }
  });

  it("checks all hook events against this install and explains stale or broken settings", () => {
    const rows = [
      { kind: "stale" },
      { kind: "missing-event" },
      { kind: "broken" },
      { kind: "wrong-arg" },
    ];
    for (const row of rows) {
      healthy();
      const path = join(project, ".claude/settings.local.json");
      if (row.kind === "broken") put(path, "{bad");
      else {
        const settings = JSON.parse(readFileSync(path, "utf8"));
        if (row.kind === "stale")
          settings.hooks.Stop[0].hooks[0].args = ["C:/old/verid/dist/hook.js"];
        else if (row.kind === "wrong-arg")
          settings.hooks.Stop[0].hooks[0].args = ["C:/other.js", join(root, "dist/hook.js")];
        else delete settings.hooks.SessionStart;
        put(path, JSON.stringify(settings));
      }
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(1);
      expect(r.out).toContain("! hooks");
      expect(r.out).toContain("verid upgrade --yes");
    }
  });

  it("accepts the developer's hooks before or after verid in every event", () => {
    healthy();
    const path = join(project, ".claude/settings.local.json");
    const original = JSON.parse(readFileSync(path, "utf8"));
    const rows = [{ placement: "before" }, { placement: "after" }, { placement: "same-group" }];
    for (const { placement } of rows) {
      const settings = structuredClone(original);
      for (const groups of Object.values(settings.hooks) as any[][]) {
        const mine = { type: "command", command: "echo developer" };
        if (placement === "before") groups.unshift({ hooks: [mine] });
        else if (placement === "after") groups.push({ hooks: [mine] });
        else groups[0].hooks.push(mine);
      }
      put(path, JSON.stringify(settings));
      const before = snapshot();
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(0);
      expect(r.out).not.toContain("! hooks");
      expect(snapshot()).toEqual(before);
    }
  });

  it("uses the chosen language or both languages for doctor findings and fixes", () => {
    healthy();
    rmSync(join(config, "plugins/installed_plugins.json"));
    const state = join(project, ".verid/.state/state.json");
    const rows = [
      { language: "vi", want: "Cách sửa:", absent: "Fix:" },
      { language: "en", want: "Fix:", absent: "Cách sửa:" },
      { language: null, want: "vi: ", absent: "doctor.problem" },
    ];
    for (const { language, want, absent } of rows) {
      put(state, JSON.stringify({ schemaVersion: 1, ...(language && { language }) }));
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(1);
      expect(r.out).toContain(want);
      expect(r.out).not.toContain(absent);
      if (language === null) {
        expect(r.out).toContain("en: ");
        expect(r.out).toContain("Fix:");
        expect(r.out).toContain("Cách sửa:");
      }
    }
  });

  it("finds plugins by name and applicable scope with an existing install directory", () => {
    const rows = [
      { kind: "absent", want: ["superpowers", "andrej-karpathy-skills", "verid"] },
      { kind: "other-project", want: ["verid"] },
      { kind: "gone", want: ["verid"] },
    ];
    for (const row of rows) {
      healthy();
      const installPath = config;
      if (row.kind === "absent") rmSync(join(config, "plugins/installed_plugins.json"));
      else
        plugins({
          "superpowers@superpowers-marketplace": [{ scope: "user", installPath }],
          "andrej-karpathy-skills@karpathy-skills": [{ scope: "user", installPath }],
          "verid@verid": [
            row.kind === "other-project"
              ? { scope: "project", projectPath: join(dir, "other"), installPath }
              : { scope: "user", installPath: join(dir, "gone") },
          ],
        });
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(1);
      for (const name of row.want) expect(r.out).toContain(`! plugin.${name}`);
      expect(r.out).toContain("claude plugin install");
    }
  });

  it("requires an applicable Karpathy plugin record and an existing install directory", () => {
    const rows = [
      { kind: "absent", scope: "user", code: 1 },
      { kind: "gone", scope: "user", code: 1 },
      { kind: "other-project", scope: "project", code: 1 },
      { kind: "other-project", scope: "local", code: 1 },
      { kind: "installed", scope: "user", code: 0 },
      { kind: "installed", scope: "project", code: 0 },
      { kind: "installed", scope: "local", code: 0 },
    ];
    for (const row of rows) {
      healthy();
      plugins({
        "superpowers@superpowers-marketplace": [{ scope: "user", installPath: config }],
        "verid@verid": [{ scope: "user", installPath: config }],
        ...(row.kind !== "absent" && {
          "andrej-karpathy-skills@karpathy-skills": [
            {
              scope: row.scope,
              projectPath: row.kind === "other-project" ? join(dir, "other") : project,
              installPath: row.kind === "gone" ? join(dir, "gone") : config,
            },
          ],
        }),
      });
      const before = snapshot();
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(row.code);
      if (row.code === 1) {
        expect(r.out).toContain("! plugin.andrej-karpathy-skills:");
        expect(r.out).toContain(
          "claude plugin marketplace add forrestchang/andrej-karpathy-skills",
        );
        expect(r.out).toContain("claude plugin install andrej-karpathy-skills@karpathy-skills");
      } else expect(r.out).toContain("= Plugin andrej-karpathy-skills looks installed");
      expect(snapshot()).toEqual(before);
    }
  });

  it("accepts a project plugin and a custom runner declaration without running tests", () => {
    healthy();
    plugins({
      "superpowers@superpowers-marketplace": [{ scope: "user", installPath: config }],
      "andrej-karpathy-skills@karpathy-skills": [{ scope: "user", installPath: config }],
      "verid@verid": [{ scope: "project", projectPath: project, installPath: config }],
    });
    manifest((m) => {
      m.repos[0].test_cmd = "node must-not-run.js {junit}";
    });
    commit();
    const r = cli(["doctor"]);
    expect(r.code, r.err + r.out).toBe(0);
    expect(r.out).toContain("custom test_cmd");
  });

  it("reports corrupt or unsupported plugin records with a fix", () => {
    const rows = [{ text: "{broken" }, { text: '{"version":99,"plugins":{}}' }];
    for (const { text } of rows) {
      healthy();
      put(join(config, "plugins/installed_plugins.json"), text);
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(1);
      expect(r.out).toContain("! plugins.record:");
      for (const line of r.out.split("\n").filter((s) => s.startsWith("!")))
        expect(line).toContain("Fix:");
    }
  });

  it("reports a missing or invalid manifest as a fixable problem with exit one", () => {
    const rows = [{ text: null }, { text: "schemaVersion: 99\n" }];
    for (const row of rows) {
      healthy();
      const path = join(project, ".verid/manifest.yaml");
      if (row.text === null) rmSync(path);
      else put(path, row.text);
      const before = snapshot();
      const r = cli(["doctor"]);
      expect(r.code, r.err + r.out).toBe(1);
      expect(r.out).toContain("! manifest");
      expect(r.out).toContain("Fix:");
      expect(snapshot()).toEqual(before);
    }
  });
});
