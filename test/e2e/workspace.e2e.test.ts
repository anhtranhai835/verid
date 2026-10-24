import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { cloneMarkerFile } from "../../src/adapters/workspace.js";

const root = join(import.meta.dirname, "../..");
const CLI = join(root, "dist/cli.js");
const HOOK = join(root, "dist/hook.js");
let temp: string;
let project: string;
const env = () => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("CLAUDE") && !key.startsWith("GIT_"),
    ),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: join(temp, "gitconfig"),
  XDG_CONFIG_HOME: temp,
});
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "verid-workspace-"));
  project = join(temp, "workspace");
  mkdirSync(project);
  writeFileSync(join(temp, "gitconfig"), "");
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));
const put = (rel: string, text = "x") => {
  mkdirSync(dirname(join(project, rel)), { recursive: true });
  writeFileSync(join(project, rel), text);
};
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    env: env(),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};
const makeRepo = (rel: string, branch = "main", committed = false) => {
  const dir = join(project, rel);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", branch);
  if (committed) git(dir, "commit", "-q", "--allow-empty", "-m", "initial fixture");
  return dir;
};
const commit = (dir: string) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "fixture");
};
const cli = (args: string[], cwd = project, extraEnv: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...env(), ...extraEnv },
    encoding: "utf8",
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};
const repo = (path: string, extra = {}) => ({
  path,
  source_globs: ["src/**"],
  test_globs: ["tests/**"],
  e2e_globs: ["e2e/**"],
  ...extra,
});
const manifest = (repos = [repo("api"), repo("web", { role: "frontend" })], extra = {}) => {
  put(
    ".verid/manifest.yaml",
    stringify({ schemaVersion: 1, mode: "remix", layout: "workspace", repos, ...extra }),
  );
  put(
    ".verid/.state/state.json",
    JSON.stringify({ schemaVersion: 1, language: "en", baseline: [] }),
  );
};
const state = () => JSON.parse(readFileSync(join(project, ".verid/.state/state.json"), "utf8"));
const writeState = (extra: object) =>
  put(".verid/.state/state.json", JSON.stringify({ ...state(), ...extra }));
const hook = (path: string, writer?: string, tool = "Write", input?: object) => {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: project,
    env: { ...env(), CLAUDE_PROJECT_DIR: project },
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "workspace",
      cwd: project,
      tool_name: tool,
      tool_input: input ?? { file_path: path, content: "test" },
      ...(writer && { agent_id: "worker", agent_type: `verid:${writer}` }),
    }),
  });
  return { code: result.status, err: result.stderr };
};

describe("workspace setup", () => {
  it("strips origin userinfo before writing shared repo metadata", () => {
    // The pure sharedRemote table covers every URL/scp spelling; one repo verifies persistence.
    const dir = makeRepo("api");
    git(dir, "remote", "add", "origin", "https://user:token@example.com/team/api.git");
    const result = cli(["cook", "--yes", "--mode", "prep"]);
    expect(result.code, result.err).toBe(0);
    const text = readFileSync(join(project, ".verid/manifest.yaml"), "utf8");
    const doc = parse(text);
    expect(doc.repos).toHaveLength(1);
    expect(doc.repos[0].remote).toBe("https://example.com/team/api.git");
    expect(text).not.toContain("token");
  });

  it("leaves default_branch unset without origin/HEAD even on a feature branch", () => {
    const rows = [
      { name: "api", branch: "feat/api", originHead: "main", expected: "main" },
      { name: "web", branch: "feat/web", originHead: undefined, expected: undefined },
    ];
    for (const row of rows) {
      const dir = makeRepo(row.name, row.branch, true);
      if (row.originHead) {
        git(dir, "update-ref", `refs/remotes/origin/${row.originHead}`, "HEAD");
        git(
          dir,
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          `refs/remotes/origin/${row.originHead}`,
        );
      }
    }
    const result = cli(["cook", "--yes"]);
    expect(result.code, result.err).toBe(0);
    const doc = parse(readFileSync(join(project, ".verid/manifest.yaml"), "utf8"));
    expect(doc.repos.map((r: Record<string, unknown>) => r.default_branch)).toEqual([
      "main",
      undefined,
    ]);
  });

  it("previews every clone remote and configured branch on a dry run", () => {
    manifest([
      repo("api", { remote: "https://example.com/team/api.git", default_branch: "main" }),
      repo("web", { remote: "git@example.com:team/web.git", default_branch: "develop" }),
    ]);
    const result = cli(["cook", "--dry-run"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("api <- https://example.com/team/api.git (main)");
    expect(result.out).toContain("web <- git@example.com:team/web.git (develop)");
    expect(existsSync(join(project, "api"))).toBe(false);
    expect(existsSync(join(project, ".verid/.git"))).toBe(false);
  });

  it("sets up a brand-new prep workspace whose child repos have no commits", () => {
    makeRepo("api");
    makeRepo("web");
    const result = cli(["cook", "--yes", "--mode", "prep", "--layout", "workspace"]);
    expect(result.code, result.err).toBe(0);
    const doc = parse(readFileSync(join(project, ".verid/manifest.yaml"), "utf8"));
    expect(doc.mode).toBe("prep");
    expect(doc.layout).toBe("workspace");
    expect(doc.repos.map((r: { path: string }) => r.path)).toEqual(["api", "web"]);
    expect(existsSync(join(project, ".verid/.git"))).toBe(true);
    expect(existsSync(join(project, ".claude/settings.local.json"))).toBe(true);
    expect(existsSync(join(project, ".verid/.state/clones"))).toBe(false);
    expect(cli(["cook", "--yes"]).code).toBe(0);
  });

  it("keeps unmarked repos without HEAD or an initialized checkout without calling them incomplete", () => {
    const rows = ["unborn", "no checkout"];
    for (const name of rows) {
      const dir = makeRepo(name);
      if (name === "no checkout") {
        writeFileSync(join(dir, "tracked.txt"), "checkout needed");
        commit(dir);
        rmSync(join(dir, ".git/index"));
        rmSync(join(dir, "tracked.txt"));
      }
      writeFileSync(join(dir, "keep.txt"), "developer work");
      manifest([repo(name)]);
      const result = cli(["cook", "--yes"]);
      expect(result.code, result.err).toBe(0);
      expect(result.err).not.toContain("incomplete");
      expect(result.out).toContain("already set up");
      expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("developer work");
    }
  });

  it("keeps a marked interrupted clone and explains how to retry when HEAD exists without a complete checkout", () => {
    const dir = makeRepo("api");
    writeFileSync(join(dir, "tracked.txt"), "checkout needed");
    commit(dir);
    rmSync(join(dir, ".git/index"));
    rmSync(join(dir, "tracked.txt"));
    writeFileSync(join(dir, "keep.txt"), "developer work");
    const marker = cloneMarkerFile(project, "api");
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "api\n");
    const rows = [
      { layout: "monorepo", staged: false },
      { layout: "workspace", staged: false },
      { layout: "monorepo", staged: true },
      { layout: "workspace", staged: true },
    ];
    for (const row of rows) {
      if (row.staged) git(dir, "add", "-A");
      manifest([repo("api", { remote: "../source.git" })], { layout: row.layout });
      const result = cli(["cook", "--yes"]);
      expect(result.code, result.err).toBe(1);
      expect(result.err).toContain("incomplete clone");
      expect(result.err).toContain("remove the folder");
      expect(result.err).toContain("verid cook");
      expect(result.out).not.toContain("already set up");
      expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("developer work");
      expect(readFileSync(marker, "utf8")).toBe("api\n");
      const denied = hook(marker);
      expect(denied.code, denied.err).toBe(2);
      expect(denied.err).toContain("VERID_BURNT_STATE_PROTECTED");
    }
  });

  it("accepts a completed checkout after a manual clone and clears its stale marker in either layout", () => {
    const dir = makeRepo("api");
    writeFileSync(join(dir, "tracked.txt"), "checked out");
    commit(dir);
    writeFileSync(join(dir, "keep.txt"), "developer work");
    const marker = cloneMarkerFile(project, "api");
    const rows = ["monorepo", "workspace"];
    for (const layout of rows) {
      manifest([repo("api", { remote: "../missing.git" })], { layout });
      mkdirSync(dirname(marker), { recursive: true });
      writeFileSync(marker, "api\n");
      const dry = cli(["cook", "--dry-run"]);
      expect(dry.code, dry.err).toBe(0);
      expect(existsSync(marker)).toBe(true);
      const result = cli(["cook", "--yes"]);
      expect(result.code, result.err).toBe(0);
      expect(result.out).toContain("already set up");
      expect(result.err).not.toContain("incomplete clone");
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("checked out");
      expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("developer work");
    }
  });

  it("names workspace discovery problems without blaming test flags", () => {
    const rows = [
      { folder: undefined, detail: "no direct child git repos" },
      { folder: "LONGFO~1", detail: "LONGFO~1" },
    ];
    const workspace = project;
    for (const [index, row] of rows.entries()) {
      project = join(workspace, String(index));
      mkdirSync(project);
      if (row.folder) makeRepo(row.folder);
      const result = cli(["cook", "--yes", "--layout", "workspace"]);
      expect(result.code).toBe(2);
      expect(result.err).toContain(row.detail);
      expect(result.err).not.toContain("--test-cmd/--src/--tests");
      expect(existsSync(join(project, ".verid"))).toBe(false);
    }
  });

  it("refuses explicit and saved workspace layouts inside an ordinary ancestor repo before writes", () => {
    git(temp, "init", "-q");
    const ancestor = join(temp, "work");
    project = join(ancestor, "ws");
    mkdirSync(project, { recursive: true });
    git(ancestor, "init", "-q");
    makeRepo("api", "main", true);
    const home = { USERPROFILE: temp, HOME: temp };
    const automatic = cli(["cook", "--dry-run"], project, home);
    expect(automatic.code, automatic.err).toBe(0);
    expect(automatic.out).toContain("layout: monorepo");
    const rows = ["explicit", "saved"];
    for (const source of rows) {
      if (source === "saved") manifest([repo("api")]);
      const before =
        source === "saved" ? readFileSync(join(project, ".verid/manifest.yaml"), "utf8") : null;
      const refused = cli(
        source === "explicit" ? ["cook", "--yes", "--layout", "workspace"] : ["cook", "--yes"],
        project,
        home,
      );
      expect(refused.code, refused.err).toBe(2);
      expect(refused.err).toContain("ancestor git repo");
      expect(refused.err).toContain(ancestor);
      expect(refused.err).toContain("--layout monorepo");
      expect(existsSync(join(project, ".claude"))).toBe(false);
      expect(existsSync(join(project, ".verid/.git"))).toBe(false);
      if (before === null) expect(existsSync(join(project, ".verid"))).toBe(false);
      else expect(readFileSync(join(project, ".verid/manifest.yaml"), "utf8")).toBe(before);
    }
  });

  it("allows workspace setup and reruns inside a home-folder dotfiles repo but refuses its own root repo", () => {
    git(temp, "init", "-q");
    const home = { USERPROFILE: temp, HOME: temp };
    const rows = [
      { folder: "ws", args: [] },
      { folder: "explicit", args: ["--layout", "workspace"] },
    ];
    for (const row of rows) {
      project = join(temp, "work", row.folder);
      mkdirSync(project, { recursive: true });
      makeRepo("api");
      makeRepo("web");
      const result = cli(["cook", "--yes", ...row.args], project, home);
      expect(result.code, result.err).toBe(0);
      expect(result.out).toContain("layout: workspace");
      const doc = parse(readFileSync(join(project, ".verid/manifest.yaml"), "utf8"));
      expect(doc.layout).toBe("workspace");
      expect(doc.repos.map((repo: { path: string }) => repo.path)).toEqual(["api", "web"]);
      expect(cli(["cook", "--yes"], project, home).code).toBe(0);
      expect(existsSync(join(project, ".git"))).toBe(false);
      git(project, "init", "-q");
      const refused = cli(["cook", "--yes"], project, home);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("workspace root");
    }
  });
  it("keeps legacy runner identities for a single monorepo repo in a subfolder", () => {
    makeRepo("api");
    manifest([repo("api")], { layout: "monorepo" });
    put("api/package.json", '{"devDependencies":{"vitest":"1"}}');
    writeState({ runners: ["vitest@."] });
    const result = cli(["cook", "--yes"]);
    expect(result.code, result.err).toBe(0);
    expect(state().runners).toEqual(["vitest@."]);
    expect(result.out).toContain("already set up");
  });
  it("refuses linked setup directories before writing through them", () => {
    const rows = [".verid", ".claude"];
    for (const rel of rows) {
      project = join(temp, rel.slice(1));
      mkdirSync(project);
      makeRepo("api");
      const outside = join(temp, `${rel.slice(1)}-outside`);
      mkdirSync(outside);
      writeFileSync(join(outside, "keep.txt"), "keep");
      symlinkSync(outside, join(project, rel), process.platform === "win32" ? "junction" : "dir");
      const result = cli(["cook", "--yes"]);
      expect(result.code).toBe(2);
      expect(readdirSync(outside)).toEqual(["keep.txt"]);
    }
  });
  it("reports missing repos without remotes as failures in either layout", () => {
    const rows = ["monorepo", "workspace"];
    for (const layout of rows) {
      manifest([repo("api"), repo("web")], { layout });
      const result = cli(["cook", "--yes"]);
      expect(result.code, result.err).toBe(1);
      expect(result.err).toContain("api");
      expect(result.err).toContain("web");
      expect(existsSync(join(project, "api"))).toBe(false);
    }
  });
  it("previews runners from every repo and preserves both remembered runners on a rerun", () => {
    makeRepo("api");
    makeRepo("web");
    manifest();
    put("api/package.json", '{"devDependencies":{"vitest":"1"}}');
    put("web/package.json", '{"devDependencies":{"vitest":"1","@playwright/test":"1"}}');
    writeState({ runners: ["vitest@api", "vitest@web"] });
    const result = cli(["cook", "--yes"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("vitest (api)");
    expect(result.out).toContain("vitest (web)");
    expect(result.out).toContain("playwright (web)");
    expect(state().runners).toEqual(["vitest@api", "vitest@web"]);
  });
  it("upgrades defaults in every repo while keeping their metadata", () => {
    makeRepo("api");
    makeRepo("web");
    manifest([
      repo("api", { test_globs: ["**/test/**"], e2e_globs: undefined, remote: "../api.git" }),
      repo("web", { test_globs: ["**/test/**"], e2e_globs: undefined, role: "frontend" }),
    ]);
    const result = cli(["upgrade", "--yes"]);
    expect(result.code, result.err).toBe(0);
    const doc = parse(readFileSync(join(project, ".verid/manifest.yaml"), "utf8"));
    expect(doc.repos.map((repo: Record<string, unknown>) => repo.e2e_globs)).toEqual([
      ["**/e2e/**", "**/*.e2e.*"],
      ["**/e2e/**", "**/*.e2e.*"],
    ]);
    expect(doc.repos[0].remote).toBe("../api.git");
    expect(doc.repos[1].role).toBe("frontend");
  });
  it("detects layout from git membership and child repos, and previews without writing", () => {
    const rows = [
      { name: "empty", parentGit: false, child: false, expected: "monorepo" },
      { name: "children", parentGit: false, child: true, expected: "workspace" },
      { name: "root repo", parentGit: true, child: true, expected: "monorepo" },
      { name: "inside repo", parentGit: true, child: false, expected: "monorepo" },
    ];
    for (const row of rows) {
      const dir = join(project, row.name);
      mkdirSync(dir);
      if (row.parentGit) git(dir, "init", "-q");
      const cwd = row.name === "inside repo" ? join(dir, "sub") : dir;
      mkdirSync(cwd, { recursive: true });
      if (row.child) {
        mkdirSync(join(cwd, "api"));
        git(join(cwd, "api"), "init", "-q");
      }
      const result = cli(["cook", "--dry-run"], cwd);
      expect(result.code, result.err).toBe(0);
      expect(result.out).toContain(`layout: ${row.expected}`);
      expect(existsSync(join(cwd, ".verid"))).toBe(false);
      expect(existsSync(join(cwd, ".claude"))).toBe(false);
    }
  });

  it("records sorted child repos, origin and branch and initializes only the .verid repo", () => {
    makeRepo("web", "develop");
    makeRepo("api", "main", true);
    const remote = join(temp, "api.git");
    git(temp, "init", "--bare", "-q", remote);
    git(join(project, "api"), "remote", "add", "origin", remote);
    git(join(project, "api"), "update-ref", "refs/remotes/origin/main", "HEAD");
    git(
      join(project, "api"),
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    const result = cli(["cook", "--yes", "--mode", "prep"]);
    expect(result.code, result.err).toBe(0);
    const doc = parse(readFileSync(join(project, ".verid/manifest.yaml"), "utf8"));
    expect(doc.layout).toBe("workspace");
    expect(result.out).toContain("git -C .verid");
    expect(
      doc.repos.map(({ path, remote, default_branch }: Record<string, string>) => ({
        path,
        remote,
        default_branch,
      })),
    ).toEqual([
      { path: "api", remote, default_branch: "main" },
      { path: "web", remote: undefined, default_branch: undefined },
    ]);
    expect(existsSync(join(project, ".git"))).toBe(false);
    expect(existsSync(join(project, ".verid/.git"))).toBe(true);
    expect(git(join(project, ".verid"), "status", "--porcelain")).not.toContain(".state");
    expect(cli(["cook", "--yes"]).out).toContain("already set up");
  });

  it("accepts an explicit monorepo layout and refuses an invalid layout before writes", () => {
    makeRepo("api");
    const bad = cli(["cook", "--yes", "--layout", "wrong"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("VERID_BURNT_INIT_INVALID");
    expect(existsSync(join(project, ".verid"))).toBe(false);
    const result = cli(["cook", "--yes", "--layout", "monorepo"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain("layout: monorepo");
    expect(parse(readFileSync(join(project, ".verid/manifest.yaml"), "utf8")).repos[0].path).toBe(
      ".",
    );
    expect(existsSync(join(project, ".verid/.git"))).toBe(false);
  });

  it("clones missing repos from local bare remotes, continues on failure and retries only missing repos", () => {
    const remote = join(temp, "source.git");
    const seed = makeRepo("seed");
    put("seed/src/a.ts");
    commit(seed);
    cpSync(join(seed, ".git"), remote, { recursive: true });
    git(remote, "config", "core.bare", "true");
    rmSync(seed, { recursive: true, force: true });
    const missing = join(temp, "later.git");
    manifest([repo("api", { remote: missing }), repo("web", { remote, default_branch: "main" })]);
    const dry = cli(["cook", "--dry-run"]);
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toContain("web");
    expect(existsSync(join(project, "web"))).toBe(false);
    expect(existsSync(join(project, ".verid/.state/clones"))).toBe(false);
    const first = cli(["cook", "--yes"]);
    expect(first.code, first.err).toBe(1);
    expect(first.err).toContain("api");
    expect(existsSync(join(project, "web/.git")), first.err).toBe(true);
    expect(existsSync(cloneMarkerFile(project, "api"))).toBe(false);
    expect(existsSync(cloneMarkerFile(project, "web"))).toBe(false);
    put("web/keep.txt", "keep my work");
    writeFileSync(cloneMarkerFile(project, "api"), "interrupted clone\n");
    cpSync(remote, missing, { recursive: true });
    const retry = cli(["cook", "--yes"]);
    expect(retry.code, retry.err).toBe(0);
    expect(existsSync(join(project, "api/.git"))).toBe(true);
    expect(existsSync(cloneMarkerFile(project, "api"))).toBe(false);
    expect(existsSync(cloneMarkerFile(project, "web"))).toBe(false);
    expect(readFileSync(join(project, "web/keep.txt"), "utf8")).toBe("keep my work");
    expect(cli(["cook", "--yes"]).out).toContain("already set up");
  });

  it("refuses a linked repo destination before cloning or writing setup files", () => {
    const outside = join(temp, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(project, "web"), process.platform === "win32" ? "junction" : "dir");
    manifest([repo("web", { remote: join(temp, "missing.git") })]);
    const result = cli(["cook", "--yes"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("VERID_BURNT_MANIFEST_INVALID");
    expect(existsSync(join(project, ".claude"))).toBe(false);
    expect(existsSync(join(outside, ".git"))).toBe(false);
  });
});

describe("workspace taste", () => {
  const runner = `"${process.execPath}" "${join(import.meta.dirname, "fake-runner.mjs")}" {junit}`;
  it("refuses a disappeared runner in the second repo before running any tests", () => {
    makeRepo("api");
    makeRepo("web");
    manifest([repo("api", { test_cmd: runner }), repo("web")]);
    writeState({ runners: ["vitest@web"] });
    const result = cli(["taste"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("VERID_BURNT_RUN_RUNNER_GONE");
    expect(result.err).toContain("web");
    expect(state().tdd ?? null).toBeNull();
  });
  it("runs every repo in its own working directory and retains failures from the second", () => {
    makeRepo("api");
    makeRepo("web");
    manifest([repo("api", { test_cmd: runner }), repo("web", { test_cmd: runner })]);
    put(
      "api/scenario.json",
      JSON.stringify({ exit: 0, junit: "vitest-green.xml", output: "API ran" }),
    );
    put(
      "web/scenario.json",
      JSON.stringify({ exit: 1, junit: "vitest-red-assert.xml", output: "WEB ran" }),
    );
    const result = cli(["taste"], join(project, "web"));
    expect(result.code, result.err).toBe(1);
    expect(state().tdd.state).toBe("COOKING");
    expect(state().tdd.failing).toHaveLength(2);
    expect(state().tdd.failing[0]).toContain("web");
    const log = readFileSync(
      join(project, ".verid/.state/runs", state().tdd.last_run, "output.log"),
      "utf8",
    );
    expect(log).toContain("API ran");
    expect(log).toContain("WEB ran");
  });

  it("uses each repo's e2e globs for evidence and namespaces otherwise identical tests", () => {
    makeRepo("api");
    makeRepo("web");
    manifest([
      repo("api", { test_cmd: runner, e2e_globs: [] }),
      repo("web", { test_cmd: runner, e2e_globs: ["test/**"] }),
    ]);
    put("api/scenario.json", JSON.stringify({ exit: 0, junit: "vitest-ac.xml", output: "api" }));
    put("web/scenario.json", JSON.stringify({ exit: 0, junit: "vitest-ac.xml", output: "web" }));
    const result = cli(["taste"]);
    expect(result.code, result.err).toBe(0);
    expect(state().tdd.passed_e2e_acs).toEqual(["AC-1"]);
    expect(result.out).toContain("4 passed");
  });
});

describe("workspace auto and doctor", () => {
  const stop = () => {
    const result = spawnSync(process.execPath, [HOOK], {
      cwd: project,
      env: { ...env(), CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "Stop", session_id: "workspace", cwd: project }),
    });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
  const ready = () => {
    makeRepo("api");
    makeRepo("web");
    manifest([repo("api"), repo("web")], {
      mode: "prep",
      drive: "auto",
      roles: {
        reviewer: ["verid:reviewer"],
        tester: ["verid:tester"],
        coder: ["verid:coder"],
      },
    });
    expect(cli(["cook", "--yes"]).code).toBe(0);
    put(".verid/research.md", "research");
    put(".verid/design.md", "design");
    put(".verid/plan.md", "## Module: product\n- AC-9 (e2e): works end to end\n");
    expect(cli(["order"]).code).toBe(0);
    const hash = createHash("sha256")
      .update(readFileSync(join(project, ".verid/plan.md")))
      .digest("hex");
    writeState({
      auto: { ...state().auto, plan_sha256: hash },
      tdd: {
        state: "PLATED",
        last_run: "fixture",
        failing: [],
        dirty: false,
        passed_acs: ["AC-9"],
        passed_e2e_acs: ["AC-9"],
      },
      review: {
        module: "product",
        agent_type: "verid:reviewer",
        file: "review.md",
        sha256: "fixture",
        at: "now",
        verdict: "pass",
      },
    });
    for (const path of ["api", "web", ".verid"]) commit(join(project, path));
  };

  it("records git presence per repo, including .verid, at signing", () => {
    ready();
    expect(state().auto.signed.git_repos).toEqual({ api: true, web: true, ".verid": true });
  });

  it("checks every repo when a passing reviewer closes a module", () => {
    ready();
    put("web/untracked.txt");
    const review = () =>
      spawnSync(process.execPath, [HOOK], {
        cwd: project,
        env: { ...env(), CLAUDE_PROJECT_DIR: project },
        encoding: "utf8",
        input: JSON.stringify({
          hook_event_name: "SubagentStop",
          session_id: "workspace",
          cwd: project,
          agent_id: "reviewer",
          agent_type: "verid:reviewer",
          last_assistant_message: "Verdict: pass",
        }),
      });
    expect(review().status).toBe(0);
    expect(state().modules.product?.served_at ?? null).toBeNull();
    commit(join(project, "web"));
    expect(review().status).toBe(0);
    expect(state().modules.product.served_at).toBeTypeOf("string");
  });

  it("holds the module for dirt in any repo or .verid and closes it once all are clean", () => {
    ready();
    for (const path of ["web", "api", ".verid"]) {
      put(`${path}/untracked.txt`);
      const held = stop();
      expect(held.code, held.err).toBe(2);
      expect(held.err).toContain("commit");
      expect(state().modules.product?.served_at ?? null).toBeNull();
      commit(join(project, path));
    }
    const closed = stop();
    expect(closed.code, closed.err).toBe(0);
    expect(state().modules.product.served_at).toBeTypeOf("string");
  });

  it("treats a repo that loses git after signing as dirty", () => {
    ready();
    renameSync(join(project, "web/.git"), join(temp, "web-git"));
    const held = stop();
    expect(held.code, held.err).toBe(2);
    expect(held.err).toContain("commit");
    expect(state().modules.product?.served_at ?? null).toBeNull();
  });

  it("reports every workspace repo and .verid without writing state or a cache", () => {
    makeRepo("api");
    makeRepo("web");
    manifest([
      repo("api", { test_cmd: "echo {junit}", default_branch: "main" }),
      repo("web", { test_cmd: "echo {junit}", default_branch: "develop" }),
    ]);
    makeRepo(".verid");
    put("web/dirty.txt");
    const before = readFileSync(join(project, ".verid/.state/state.json"), "utf8");
    const result = cli(["doctor"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Repo api");
    expect(result.out).toContain("web has uncommitted");
    expect(result.out).toContain("develop");
    expect(result.out).toContain(".verid has uncommitted");
    expect(readFileSync(join(project, ".verid/.state/state.json"), "utf8")).toBe(before);
    expect(existsSync(join(project, ".verid/.state/manifest.cache.json"))).toBe(false);
  });
});

describe("workspace hook", () => {
  it("allows monorepo test writes through a junctioned project or repo root and still gates code", () => {
    const rows = [
      { name: "real project", linkedProject: false, repoPath: "." },
      { name: "junctioned project", linkedProject: true, repoPath: "." },
      { name: "linked child repo", linkedProject: false, repoPath: "api" },
      { name: "both linked", linkedProject: true, repoPath: "api" },
    ];
    for (const row of rows) {
      project = join(temp, row.name);
      mkdirSync(project);
      if (row.repoPath !== ".") {
        const target = join(temp, `${row.name}-repo`);
        mkdirSync(target);
        symlinkSync(
          target,
          join(project, row.repoPath),
          process.platform === "win32" ? "junction" : "dir",
        );
      }
      manifest([repo(row.repoPath)], { layout: "monorepo" });
      if (row.linkedProject) {
        const link = join(temp, `${row.name}-opened`);
        symlinkSync(project, link, process.platform === "win32" ? "junction" : "dir");
        project = link;
      }
      const test = hook(join(row.repoPath, "tests/new.ts"));
      expect(test.code, `${row.name}: ${test.err}`).toBe(0);
      const code = hook(join(row.repoPath, "src/new.ts"));
      expect(code.code, code.err).toBe(2);
      expect(code.err).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
    }
  });
  it("resolves every repo's globs and lets qa write e2e in any repo only through TDD", () => {
    makeRepo("api");
    makeRepo("web");
    manifest([repo("api", { e2e_globs: ["checks/**"] }), repo("web", { role: "frontend" })], {
      roles: { tester: ["verid:tester"], coder: ["verid:coder"], qa: ["verid:qa"] },
    });
    const rows = [
      { path: "api/checks/a.ts", writer: "qa", cycle: "RAW", code: 0, error: "" },
      { path: "web/e2e/a.ts", writer: "qa", cycle: "RAW", code: 0, error: "" },
      {
        path: "web/tests/a.ts",
        writer: "qa",
        cycle: "RAW",
        code: 2,
        error: "VERID_BURNT_ROLE_QA_E2E_ONLY",
      },
      {
        path: "web/src/a.ts",
        writer: "coder",
        cycle: "RAW",
        code: 2,
        error: "VERID_BURNT_TDD_NO_FAILING_TEST",
      },
      {
        path: "web/e2e/a.ts",
        writer: "qa",
        cycle: "COOKING",
        code: 2,
        error: "VERID_BURNT_TDD_TEST_FROZEN",
      },
      {
        path: "web/e2e/a.ts",
        writer: "coder",
        cycle: "RAW",
        code: 2,
        error: "VERID_BURNT_ROLE_TESTER_ONLY",
      },
      { path: "notes/a.ts", writer: "coder", cycle: "RAW", code: 0, error: "" },
      {
        path: "notes/a.ts",
        writer: "qa",
        cycle: "RAW",
        code: 2,
        error: "VERID_BURNT_ROLE_QA_E2E_ONLY",
      },
      {
        path: "web/.env",
        writer: "qa",
        cycle: "RAW",
        code: 2,
        error: "VERID_BURNT_SECRET_PROTECTED",
      },
    ];
    for (const row of rows) {
      writeState({ tdd: { state: row.cycle, last_run: null } });
      const result = hook(row.path, row.writer);
      expect(result.code, `${row.path}: ${result.err}`).toBe(row.code);
      if (row.error) expect(result.err).toContain(row.error);
    }
  });

  it("keeps the stricter written and resolved decision for junctions across repos and outside them", () => {
    makeRepo("api");
    makeRepo("web");
    manifest();
    mkdirSync(join(project, "web/e2e"));
    symlinkSync(
      join(project, "web/e2e"),
      join(project, "api/src"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const escaped = join(temp, "escaped");
    mkdirSync(escaped);
    symlinkSync(
      escaped,
      join(project, "web/src"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const rows = ["api/src/new.ts", "web/src/new.ts", "WEB\\SRC\\new.ts"];
    for (const path of rows) {
      const result = hook(path);
      expect(result.code, result.err).toBe(2);
      expect(result.err).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
    }
  });

  it("fails closed when any listed repo disappears", () => {
    makeRepo("api");
    manifest();
    const result = hook("api/tests/a.ts");
    expect(result.code).toBe(2);
    expect(result.err).toContain("VERID_BURNT_MANIFEST_INVALID");
  });
});
