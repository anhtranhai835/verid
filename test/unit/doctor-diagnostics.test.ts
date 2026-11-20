import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { appendAudit } from "../../src/adapters/audit-log.js";
import { wireProjectHooks } from "../../src/adapters/hook-wiring.js";
import * as git from "../../src/adapters/git.js";
import { setLanguage } from "../../src/adapters/i18n.js";
import { auditWarnings } from "../../src/adapters/rule-audit.js";
import * as ruleAudit from "../../src/adapters/rule-audit.js";
import { readState, statePaths } from "../../src/adapters/state-store.js";
import { doctorCommand } from "../../src/cli/doctor.js";
import { approve } from "../../src/cli/order.js";
import { status } from "../../src/cli/peek.js";
import { parseManifest } from "../../src/core/manifest.js";
import { projectManifest, tempProject } from "../support/project.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

const p = tempProject("verid-doctor-diagnostics-", {
  state: { schemaVersion: 1, language: "en" },
});
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
  Object.defineProperty(process, "platform", platformDescriptor);
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  setLanguage(null);
});

type SandboxCase = {
  runner: "none" | "custom" | "detected" | "legacy" | "workspace";
  projectConfig?: string | "unreadable";
  userConfig?: string | "unreadable";
  defaultHome?: boolean;
};

async function windowsSandbox(row: SandboxCase) {
  p.fresh();
  Object.defineProperty(process, "platform", { ...platformDescriptor, value: "win32" });
  vi.mocked(os.homedir).mockReturnValue(p.path("home"));
  vi.stubEnv("CODEX_HOME", row.defaultHome ? "" : p.path("codex-home"));
  setLanguage("en");
  vi.spyOn(ruleAudit, "auditLines").mockReturnValue([]);
  vi.mocked(spawnSync).mockImplementation((file) =>
    file === "codex --version"
      ? result("codex-cli 0.164.0\n")
      : result("", "fatal: not a git repository"),
  );
  const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };
  const custom = { test_cmd: "test-runner {junit}" };
  const repos =
    row.runner === "legacy"
      ? [
          { ...repo, path: "app" },
          { ...repo, path: "old", role: "legacy", read_only: true, ...custom },
        ]
      : [
          {
            ...repo,
            ...(row.runner === "custom" ? custom : {}),
            ...(row.runner === "workspace" ? { path: "app" } : {}),
          },
        ];
  const manifest = projectManifest({
    providers: ["codex"],
    repos,
    ...(row.runner === "legacy" ? { mode: "reheat" } : {}),
    ...(row.runner === "workspace" ? { layout: "workspace" } : {}),
  });
  const parsed = parseManifest(manifest);
  if (!parsed.ok) throw new Error(parsed.detail);
  p.put(".verid/manifest.yaml", stringify(manifest));
  for (const r of repos) mkdirSync(p.path(r.path), { recursive: true });
  if (row.runner === "detected") p.put("package.json", '{"devDependencies":{"vitest":"*"}}');
  if (row.runner === "workspace")
    p.put(".verid/package.json", '{"devDependencies":{"vitest":"*"}}');
  if (row.runner === "legacy") p.put("old/package.json", '{"devDependencies":{"vitest":"*"}}');
  for (const [file, config] of [
    [".codex/config.toml", row.projectConfig],
    [row.defaultHome ? "home/.codex/config.toml" : "codex-home/config.toml", row.userConfig],
  ]) {
    if (config === "unreadable") mkdirSync(p.path(file!), { recursive: true });
    else if (config !== undefined) p.put(file!, config);
  }
  const r = await doctorCommand(p.root);
  const lines = r.stdout.trimEnd().split("\n");
  const summary = /^(\d+) problem\(s\) and (\d+) warning\(s\)/.exec(lines.at(-1)!);
  expect(summary, r.stdout).not.toBeNull();
  return { stdout: r.stdout, warnings: Number(summary![2]) };
}

const fullAccess = 'sandbox_mode = "danger-full-access"\n';

it("warns about missing work bases and fills them in on a later order", async () => {
  p.contextSetup();
  p.put(".verid/research.md", "# Research\n");
  p.put(".verid/design.md", "# Design\n");
  p.put(".verid/spec.md", "- REQ-1: share a greeting\n");
  p.putPlan(".verid/plan.md", "## Module: greet\n- AC-1: shares a greeting\n");
  const missing = { repo: ".", detail: "main main has no commit yet" };
  const firstBase = { ".": { main: "main", base: "a".repeat(40) } };
  const rows = [
    { captured: missing, work: {} },
    { captured: firstBase, work: firstBase },
    { captured: { ".": { main: "main", base: "b".repeat(40) } }, work: firstBase },
  ];
  const capture = vi.spyOn(git, "captureWork");
  for (const row of rows) {
    capture.mockReturnValue(row.captured);
    expect((await approve(p.root, "greet")).exit).toBe(0);
    expect(p.state().modules.greet.work).toEqual(row.work);
    const warnings = p.audit().filter((event) => event.code === "GIT_WORK_BASE");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ event: "warning", target: ".", reason: missing.detail });
  }
});

it("recognizes registered hooks in either resource mode", async () => {
  const rows = ["installed", "repo"] as const;
  for (const resources of rows) {
    const manifest = projectManifest({ resources });
    const parsed = parseManifest(manifest);
    if (!parsed.ok) throw new Error(parsed.detail);
    p.put(".verid/manifest.yaml", stringify(manifest));
    wireProjectHooks(p.root, parsed.manifest);
    expect((await status(p.root)).stderr, resources).toBe("");
  }
});

it("matches project-scoped plugin paths using platform case rules", async () => {
  p.contextSetup("en", { resources: "installed" });
  setLanguage("en");
  const installed = p.path("plugin");
  mkdirSync(installed);
  vi.stubEnv("CLAUDE_CONFIG_DIR", p.path("claude-home"));
  vi.mocked(spawnSync).mockReturnValue(result(""));
  const rows = [
    ["win32", p.root.toUpperCase(), false],
    ["linux", p.root.toUpperCase(), true],
    ["linux", p.root, false],
  ] as const;
  for (const [platform, projectPath, missing] of rows) {
    Object.defineProperty(process, "platform", { ...platformDescriptor, value: platform });
    p.put(
      "claude-home/plugins/installed_plugins.json",
      JSON.stringify({ version: 2, plugins: { "verid@verid": [{ scope: "project", projectPath, installPath: installed }] } }),
    );
    const { stdout } = await doctorCommand(p.root);
    expect(stdout.includes("verid does not look installed for this project"), platform).toBe(missing);
  }
});

it("requires workspace Git metadata in each repository folder", async () => {
  p.contextSetup("en", {
    layout: "workspace",
    repos: ["app", "docs"].map((path) => ({ path, source_globs: ["src/**"], test_globs: ["test/**"] })),
  });
  setLanguage("en");
  mkdirSync(p.path("app/.git"), { recursive: true });
  mkdirSync(p.path("docs"));
  const probe = vi.spyOn(git, "gitView").mockReturnValue({ clean: true, head: "a".repeat(40) });
  vi.mocked(spawnSync).mockReturnValue(result(""));
  const { stdout } = await doctorCommand(p.root);
  const rows = [["app", true], ["docs", false], [".verid", false]] as const;
  for (const [repo, hasGit] of rows) {
    expect(probe.mock.calls.some(([folder]) => folder === p.path(repo)), repo).toBe(hasGit);
    if (!hasGit) expect(stdout).toContain(`${repo} is not a Git repo`);
  }
});

it("reports Windows Codex sandbox verification as information when no test runner exists", async () => {
  const rows: SandboxCase[] = [
    { runner: "none" },
    { runner: "none", projectConfig: fullAccess },
    { runner: "legacy" },
    { runner: "workspace" },
  ];
  for (const row of rows) {
    const r = await windowsSandbox(row);
    expect(r.stdout, JSON.stringify(row)).toContain(
      "= Codex Windows sandbox not verified (no test runner yet)",
    );
    expect(r.warnings, JSON.stringify(row)).toBe(1); // Only the existing hook re-trust notice.
  }
});

it("counts a Windows Codex sandbox warning when a runner lacks top-level full access", async () => {
  const rows: SandboxCase[] = [
    { runner: "custom" },
    {
      runner: "custom",
      projectConfig:
        fullAccess + 'profile = "safe"\n[profiles.safe]\nsandbox_mode = "workspace-write"\n',
      userConfig: fullAccess,
    },
    {
      runner: "detected",
      userConfig:
        fullAccess + 'profile = "safe"\n[profiles.safe]\nsandbox_mode = "workspace-write"\n',
    },
    { runner: "detected", userConfig: 'sandbox_mode = "workspace-write"\n' },
    { runner: "custom", projectConfig: 'sandbox_mode = "read-only"\n', userConfig: fullAccess },
    { runner: "custom", projectConfig: "[agents.reviewer]\n" + fullAccess },
    { runner: "detected", userConfig: "[profile]\n" + fullAccess },
    { runner: "custom", projectConfig: "# " + fullAccess },
    { runner: "custom", projectConfig: 'note = """\n' + fullAccess + '"""\n' },
    { runner: "custom", projectConfig: "[[profiles]]\n" + fullAccess },
    { runner: "custom", projectConfig: 'sandbox_mode = "danger-full-access-extra"\n' },
    { runner: "custom", projectConfig: "unreadable", userConfig: "unreadable" },
  ];
  for (const row of rows) {
    const r = await windowsSandbox(row);
    expect(r.stdout, JSON.stringify(row)).toContain(
      "! On Windows, Codex's sandbox may block verid taste from starting the test runner",
    );
    expect(r.warnings, JSON.stringify(row)).toBe(2);
  }
});

it("reports Windows Codex full access as ok without counting a sandbox warning", async () => {
  const rows: SandboxCase[] = [
    { runner: "custom", projectConfig: fullAccess },
    { runner: "custom", projectConfig: fullAccess + 'profile = "missing"\n' },
    {
      runner: "custom",
      projectConfig: fullAccess + 'profile = "safe"\n[profiles.safe]\nmodel = "test"\n',
    },
    {
      runner: "custom",
      projectConfig:
        'sandbox_mode = "workspace-write"\nprofile = "open"\n[profiles.open]\n' + fullAccess,
    },
    {
      runner: "detected",
      userConfig: 'profile = "open"\n[profiles.open]\n' + fullAccess,
    },
    { runner: "detected", userConfig: fullAccess },
    {
      runner: "custom",
      projectConfig: fullAccess,
      userConfig: 'sandbox_mode = "workspace-write"\n',
    },
    { runner: "custom", projectConfig: "[agents.reviewer]\n" + fullAccess, userConfig: fullAccess },
    { runner: "custom", projectConfig: "unreadable", userConfig: fullAccess },
    { runner: "custom", userConfig: fullAccess, defaultHome: true },
    {
      runner: "custom",
      projectConfig: "# Sandbox\r\n sandbox_mode = 'danger-full-access' # local\r\n[agents]\r\n",
    },
  ];
  for (const row of rows) {
    const r = await windowsSandbox(row);
    expect(r.stdout, JSON.stringify(row)).toContain(
      '= Codex Windows sandbox: sandbox_mode = "danger-full-access"; test runner configured',
    );
    expect(r.warnings, JSON.stringify(row)).toBe(1);
  }
});

const sandbox = "this sandbox cannot start Git (inside Codex, run verid doctor from a terminal)";
const result = (stdout = "", stderr = "", error?: Error) =>
  ({
    status: error ? null : stderr ? 128 : 0,
    stdout,
    stderr,
    error,
    output: [null, stdout, stderr],
    pid: 1,
    signal: null,
  }) as ReturnType<typeof spawnSync>;

it("explains sandbox Git refusals at every audit probe while preserving real Git errors", () => {
  const parsed = parseManifest(
    projectManifest({
      repos: [
        { path: ".", default_branch: "main", source_globs: ["src/**"], test_globs: ["test/**"] },
      ],
    }),
  );
  if (!parsed.ok) throw new Error(parsed.detail);
  const probes = [
    { probe: "root", arg: "--show-toplevel", prefix: "" },
    { probe: "default_branch", arg: "--show-toplevel", prefix: ".: default_branch of .: " },
    { probe: "facts", arg: "--absolute-git-dir", prefix: ".: " },
    { probe: "branch", arg: "symbolic-ref", prefix: ".: " },
    { probe: "refs", arg: "for-each-ref", prefix: ".: " },
    { probe: "status", arg: "status", prefix: ".: " },
  ];
  const rows = [
    ...probes.flatMap(({ probe, arg, prefix }) =>
      ["EPERM", "EACCES"].map((code) => ({
        probe,
        arg,
        error: Object.assign(new Error(`spawnSync git ${code}`), { code }),
        thrown: false,
        want: `[GIT_UNRESOLVED] ${prefix}${sandbox}`,
      })),
    ),
    {
      probe: "root",
      arg: "--show-toplevel",
      error: new Error("spawnSync git EPERM"),
      thrown: false,
      want: `[GIT_UNRESOLVED] ${sandbox}`,
    },
    {
      probe: "root",
      arg: "--show-toplevel",
      error: new Error("spawnSync git EACCES"),
      thrown: true,
      want: `[AUDIT_UNAVAILABLE] ${sandbox}`,
    },
    {
      probe: "root",
      arg: "--show-toplevel",
      error: Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" }),
      thrown: false,
      want: "[GIT_UNRESOLVED] git did not run: ENOENT",
    },
    {
      probe: "facts",
      arg: "--absolute-git-dir",
      stderr: "fatal: not a git repository",
      want: "[GIT_UNRESOLVED] .: not a git repository",
    },
    {
      probe: "facts",
      arg: "--absolute-git-dir",
      stderr: "fatal: bad revision 'main'",
      want: "[GIT_UNRESOLVED] .: fatal: bad revision 'main'",
    },
  ];
  for (const row of rows) {
    // Both root discovery and default-branch lookup use the same Git arguments.
    const roots =
      row.probe === "default_branch"
        ? vi.spyOn(git, "workRoots").mockReturnValue([{ repo: ".", top: p.root }])
        : undefined;
    vi.mocked(spawnSync).mockImplementation((_file, args) => {
      if (
        args?.includes(row.arg) &&
        (row.arg !== "--show-toplevel" || !args.includes("--absolute-git-dir"))
      ) {
        if (row.thrown) throw row.error;
        return result("", row.stderr, row.error);
      }
      if (args?.includes("--absolute-git-dir"))
        return result(`${p.root}\n${join(p.root, ".git")}\n`);
      if (args?.includes("--show-toplevel")) return result(p.root);
      if (args?.includes("symbolic-ref")) return result("refs/heads/feat/test\n");
      if (args?.includes("for-each-ref")) return result("refs/heads/main\0\n");
      return result();
    });
    try {
      expect(
        auditWarnings(p.root, parsed.manifest, readState(statePaths(p.root))),
        JSON.stringify(row),
      ).toEqual([row.want]);
    } finally {
      roots?.mockRestore();
    }
  }
});

it("distinguishes unverified signed repositories from repositories missing after Git ran", () => {
  const parsed = parseManifest(projectManifest());
  if (!parsed.ok) throw new Error(parsed.detail);
  const state = readState(statePaths(p.root));
  state.auto.signed = {
    at: "2026-01-01T00:00:00Z",
    research_sha256: "",
    spec_sha256: null,
    design_sha256: "",
    git: true,
    git_repos: { ".": true, api: true, docs: false },
  };
  const rows = [
    {
      root: result("", "", Object.assign(new Error("spawnSync git EPERM"), { code: "EPERM" })),
      want: [`[GIT_UNRESOLVED] .: ${sandbox}`, `[GIT_UNRESOLVED] api: ${sandbox}`],
    },
    {
      root: result("", "", Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" })),
      want: [
        "[GIT_UNRESOLVED] .: could not verify repository in Git",
        "[GIT_UNRESOLVED] api: could not verify repository in Git",
      ],
    },
    {
      root: result(p.root),
      want: ["[GIT_UNRESOLVED] api: repository no longer in Git"],
    },
  ];
  for (const { root, want } of rows) {
    vi.mocked(spawnSync).mockImplementation((_file, args) => {
      if (args?.includes("--absolute-git-dir"))
        return result(`${p.root}\n${join(p.root, ".git")}\n`);
      if (args?.includes("--show-toplevel")) return root;
      if (args?.includes("symbolic-ref")) return result("refs/heads/feat/test\n");
      if (args?.includes("for-each-ref")) return result("refs/heads/main\0\n");
      return result();
    });
    expect(
      auditWarnings(p.root, parsed.manifest, state).filter((w) => w.startsWith("[GIT_")),
    ).toEqual(want);
  }
});

it("counts every printed doctor problem and warning, including unique audit entries and unavailable audits", async () => {
  const rows = [
    { state: true, ci: false, probe: "EPERM" },
    { state: true, ci: false, probe: "EACCES" },
    { state: true, ci: false, probe: "ENOENT" },
    { state: false, ci: false, probe: "EPERM" },
    { state: false, ci: true, probe: "EPERM" },
  ];
  for (const row of rows) {
    p.put(".verid/.state/state.json", JSON.stringify({ schemaVersion: 1, language: "en" }));
    p.put(".verid/manifest.yaml", stringify(projectManifest({ providers: ["codex"] })));
    if (row.state)
      appendAudit(p.auditFile, {
        event: "module_served",
        warnings: ["[HISTORY] prior warning", "[HISTORY] prior warning"],
      });
    else rmSync(p.stateFile);
    vi.stubEnv("CODEX_HOME", p.path("codex-home"));
    setLanguage("en");
    vi.mocked(spawnSync).mockReturnValue(
      result("", "", Object.assign(new Error(`spawnSync ${row.probe}`), { code: row.probe })),
    );
    const r = await doctorCommand(p.root, row.ci);
    const lines = r.stdout.trimEnd().split("\n");
    const summary = /^(\d+) problem\(s\) and (\d+) warning\(s\)/.exec(lines.at(-1)!);
    expect(summary, r.stdout).not.toBeNull();
    const problems = lines.filter(
      (line) => line.startsWith("! ") && line.includes(". Fix:"),
    ).length;
    const warnings = lines.filter(
      (line) =>
        (line.startsWith("! ") && !line.includes(". Fix:")) ||
        line.startsWith("  [") ||
        line.startsWith("verid: audit unavailable:"),
    ).length;
    expect(Number(summary![1]), r.stdout).toBe(problems);
    expect(Number(summary![2]), r.stdout).toBe(warnings);
    if (row.state && !row.ci)
      expect(lines.filter((line) => line === "  [HISTORY] prior warning")).toHaveLength(1);
    expect(r.exit).toBe(problems ? 1 : 0);
  }
});
