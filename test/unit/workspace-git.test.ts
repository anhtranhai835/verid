import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  checkWorkspaceRoot,
  cloneMarkerFile,
  cloneMissingRepo,
  detectLayout,
  sharedRemote,
  workspaceGit,
} from "../../src/adapters/workspace.js";
import { planCook } from "../../src/cli/init.js";
import { renderManifest } from "../../src/core/manifest.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, writeFileSync: vi.fn(fs.writeFileSync), rmSync: vi.fn(fs.rmSync) };
});

let project: string;
const repo = {
  path: "apps/api",
  remote: "../source.git",
  source_globs: ["src/**"],
  test_globs: ["tests/**"],
};
const result = (status = 0, stdout = "", stderr = "") =>
  ({ status, stdout, stderr, output: [null, stdout, stderr], pid: 1, signal: null }) as ReturnType<
    typeof spawnSync
  >;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-clone-unit-"));
  vi.mocked(spawnSync).mockReset().mockReturnValue(result());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(writeFileSync).mockReset();
  vi.mocked(rmSync).mockReset();
  rmSync(project, { recursive: true, force: true });
});

it("uses the home-dotfiles exemption for both automatic detection and workspace validation", () => {
  const home = homedir();
  const workspace = join(project, "work/ws");
  mkdirSync(join(workspace, "api/.git"), { recursive: true });
  mkdirSync(join(workspace, "web/.git"), { recursive: true });
  const rows = [
    { top: home, ownGit: false, layout: "workspace", allowed: true },
    { top: join(project, "work"), ownGit: false, layout: "monorepo", allowed: false },
    { top: home, ownGit: true, layout: "monorepo", allowed: false },
  ];
  for (const row of rows) {
    if (row.ownGit) mkdirSync(join(workspace, ".git"));
    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      if (args?.includes("--is-inside-work-tree")) return result(0, "true");
      if (args?.includes("--show-toplevel")) return result(0, row.top);
      return result(1);
    });
    expect(detectLayout(workspace).layout, row.top).toBe(row.layout);
    if (row.allowed) expect(() => checkWorkspaceRoot(workspace)).not.toThrow();
    else expect(() => checkWorkspaceRoot(workspace)).toThrow("VERID_BURNT_INIT_INVALID");
  }
});

it("leaves the developer's clone command without a timeout", () => {
  cloneMissingRepo(project, repo);
  expect(vi.mocked(spawnSync).mock.calls[0]?.[2]?.timeout).toBeUndefined();
});

it("inherits clone stdio so git can show progress, errors and credential prompts", () => {
  cloneMissingRepo(project, repo);
  expect(vi.mocked(spawnSync).mock.calls[0]?.[2]?.stdio).toBe("inherit");
});

it("restricts clone protocols even if the developer allows external helpers", () => {
  vi.stubEnv("GIT_ALLOW_PROTOCOL", "ext:fd");
  cloneMissingRepo(project, repo);
  expect(vi.mocked(spawnSync).mock.calls[0]?.[2]?.env?.GIT_ALLOW_PROTOCOL).toBe(
    "https:ssh:git:file",
  );
});

it("preserves the developer's ssh command and terminal prompt settings", () => {
  const rows = [
    { ssh: undefined, prompt: undefined },
    { ssh: "custom-ssh --agent", prompt: "1" },
  ];
  for (const row of rows) {
    vi.stubEnv("GIT_SSH_COMMAND", row.ssh);
    vi.stubEnv("GIT_TERMINAL_PROMPT", row.prompt);
    workspaceGit(project, ["clone", "--", repo.remote, join(project, "api")]);
    const options = vi.mocked(spawnSync).mock.lastCall?.[2];
    expect(options?.env?.GIT_SSH_COMMAND).toBe(row.ssh);
    expect(options?.env?.GIT_TERMINAL_PROMPT).toBe(row.prompt);
  }
});

it("cleans only its newly created clone destination after git fails or throws", () => {
  const rows = ["failure", "spawn error", "throw"];
  for (const failure of rows) {
    const folder = join(project, repo.path);
    mkdirSync(join(project, "apps"), { recursive: true });
    writeFileSync(join(project, "apps/keep.txt"), "developer work");
    vi.mocked(spawnSync).mockImplementation(() => {
      mkdirSync(join(folder, ".git"), { recursive: true });
      writeFileSync(join(folder, "partial"), "incomplete");
      if (failure === "throw") throw new Error("spawn failed");
      return failure === "spawn error"
        ? { ...result(), error: new Error("spawn failed") }
        : result(1);
    });
    expect(cloneMissingRepo(project, repo).ok).toBe(false);
    expect(existsSync(folder), failure).toBe(false);
    expect(existsSync(cloneMarkerFile(project, repo.path)), failure).toBe(false);
    expect(readFileSync(join(project, "apps/keep.txt"), "utf8")).toBe("developer work");
  }
});

it("keeps the pending marker if cleaning a failed clone's destination fails", () => {
  vi.mocked(spawnSync).mockReturnValue(result(1));
  vi.mocked(rmSync).mockImplementationOnce(() => {
    throw new Error("EACCES: cannot remove partial clone");
  });
  expect(() => cloneMissingRepo(project, repo)).toThrow("EACCES: cannot remove partial clone");
  expect(existsSync(join(project, repo.path))).toBe(true);
  expect(existsSync(cloneMarkerFile(project, repo.path))).toBe(true);
});

it("marks a clone before starting git and clears only that marker after success, even without HEAD", () => {
  const marker = cloneMarkerFile(project, repo.path);
  const other = cloneMarkerFile(project, "apps/web");
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, "interrupted web clone");
  vi.mocked(spawnSync).mockImplementation(() => {
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, "utf8")).toContain("apps/api");
    return result();
  });
  expect(cloneMissingRepo(project, repo)).toEqual({ ok: true, missing: true });
  expect(existsSync(marker)).toBe(false);
  expect(readFileSync(other, "utf8")).toBe("interrupted web clone");
  expect(spawnSync).toHaveBeenCalledTimes(1);
});

it("accepts existing unborn repos with or without a remote and never tries to clone them", () => {
  const folder = join(project, repo.path);
  mkdirSync(join(folder, ".git"), { recursive: true });
  writeFileSync(join(folder, "keep.txt"), "developer work");
  vi.mocked(spawnSync).mockImplementation((_cmd, args) =>
    args?.includes("--is-inside-work-tree") ? result(0, "true") : result(1),
  );
  const rows = [{ ...repo, remote: undefined }, repo];
  for (const row of rows) {
    expect(cloneMissingRepo(project, row)).toEqual({ ok: true, missing: false });
    expect(readFileSync(join(folder, "keep.txt"), "utf8")).toBe("developer work");
  }
  expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => args?.includes("clone"))).toBe(false);
  expect(existsSync(cloneMarkerFile(project, repo.path))).toBe(false);
});

it("reports only marked existing folders as incomplete and keeps their contents and marker", () => {
  const marker = cloneMarkerFile(project, repo.path);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, "interrupted clone");
  const folder = join(project, repo.path);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "keep.txt"), "developer work");
  const rows = [
    { ownGit: false, workTree: false, head: false, index: false, cachedStatus: 0 },
    { ownGit: true, workTree: false, head: true, index: true, cachedStatus: 0 },
    { ownGit: true, workTree: true, head: false, index: true, cachedStatus: 0 },
    { ownGit: true, workTree: true, head: true, index: false, cachedStatus: 0 },
    { ownGit: true, workTree: true, head: true, index: true, cachedStatus: 1 },
    { ownGit: true, workTree: true, head: true, index: true, cachedStatus: 128 },
  ];
  for (const row of rows) {
    if (row.ownGit) mkdirSync(join(folder, ".git"), { recursive: true });
    if (row.index) writeFileSync(join(folder, ".git/index"), "checkout index");
    else if (row.ownGit) rmSync(join(folder, ".git/index"), { force: true });
    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      if (args?.includes("--is-inside-work-tree")) return result(0, String(row.workTree));
      if (args?.includes("--verify")) return row.head ? result(0, "a".repeat(40)) : result(1);
      if (args?.includes("--git-path")) return result(0, ".git/index");
      if (args?.join(" ") === "diff --cached --quiet HEAD") return result(row.cachedStatus);
      return result(1);
    });
    expect(cloneMissingRepo(project, repo)).toEqual({
      ok: false,
      missing: false,
      incomplete: true,
    });
    expect(readFileSync(join(folder, "keep.txt"), "utf8")).toBe("developer work");
    expect(readFileSync(marker, "utf8")).toBe("interrupted clone");
  }
  expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => args?.includes("clone"))).toBe(false);
});

it("accepts a marked completed checkout and clears only its marker without cloning", () => {
  const folder = join(project, repo.path);
  mkdirSync(join(folder, ".git"), { recursive: true });
  writeFileSync(join(folder, ".git/index"), "checkout index");
  writeFileSync(join(folder, "keep.txt"), "developer work");
  const marker = cloneMarkerFile(project, repo.path);
  const other = cloneMarkerFile(project, "apps/web");
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, "interrupted clone");
  writeFileSync(other, "unfinished web clone");
  vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
    if (args?.includes("--is-inside-work-tree")) return result(0, "true");
    if (args?.includes("--verify")) return result(0, "a".repeat(40));
    if (args?.includes("--git-path")) return result(0, ".git/index");
    if (args?.join(" ") === "diff --cached --quiet HEAD") return result();
    return result(1);
  });
  expect(cloneMissingRepo(project, repo)).toEqual({ ok: true, missing: false });
  expect(existsSync(marker)).toBe(false);
  expect(readFileSync(other, "utf8")).toBe("unfinished web clone");
  expect(readFileSync(join(folder, "keep.txt"), "utf8")).toBe("developer work");
  expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => args?.includes("clone"))).toBe(false);
});

it("clears a stale marker when its folder is gone, even if cloning cannot start yet", () => {
  const marker = cloneMarkerFile(project, repo.path);
  const rows = [undefined, "-unsafe"];
  for (const remote of rows) {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "interrupted clone");
    expect(cloneMissingRepo(project, { ...repo, remote })).toEqual({ ok: false, missing: true });
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(project, repo.path))).toBe(false);
  }
  expect(spawnSync).not.toHaveBeenCalled();
});

it("retries a marked clone after its destination is removed and clears the new marker on success", () => {
  const marker = cloneMarkerFile(project, repo.path);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, "interrupted clone");
  expect(existsSync(join(project, repo.path))).toBe(false);
  vi.mocked(spawnSync).mockImplementation(() => {
    expect(readFileSync(marker, "utf8")).toBe(`${repo.path}\n`);
    return result();
  });
  expect(cloneMissingRepo(project, repo)).toEqual({ ok: true, missing: true });
  expect(existsSync(marker)).toBe(false);
  expect(spawnSync).toHaveBeenCalledTimes(1);
});

it("reports marker-write errors and refuses to start git without a marker", () => {
  const rows = [
    "EACCES: permission denied writing clone marker",
    "ENOSPC: no space left on device",
  ];
  for (const detail of rows) {
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error(detail);
    });
    expect(cloneMissingRepo(project, repo)).toEqual({ ok: false, missing: true, detail });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(existsSync(join(project, repo.path))).toBe(false);
    expect(existsSync(cloneMarkerFile(project, repo.path))).toBe(false);
  }
});

it("includes the marker-write error in cook's setup failure without starting git", async () => {
  vi.stubEnv("CLAUDECODE", undefined);
  mkdirSync(join(project, ".verid"));
  writeFileSync(join(project, ".verid/manifest.yaml"), renderManifest("prep", repo));
  const plan = await planCook(project, { src: [], tests: [] });
  const marker = cloneMarkerFile(project, repo.path);
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(writeFileSync).mockImplementation((...args) => {
    if (String(args[0]) === marker) throw new Error("ENOSPC: no space left writing clone marker");
    return fs.writeFileSync(...args);
  });
  const result = plan.apply();
  expect(result.failed).toBe(true);
  expect(result.stderr).toContain("setup failed");
  expect(result.stderr).toContain("ENOSPC: no space left writing clone marker");
  expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => args?.includes("clone"))).toBe(false);
  expect(existsSync(join(project, repo.path))).toBe(false);
});

it("preserves unmarked non-repo folders without labeling them as incomplete clones", () => {
  const folder = join(project, repo.path);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "keep.txt"), "developer work");
  vi.mocked(spawnSync).mockImplementation((_cmd, args) =>
    args?.includes("--is-inside-work-tree") ? result(0, "true") : result(1),
  );
  expect(cloneMissingRepo(project, repo)).toEqual({ ok: false, missing: false });
  expect(readFileSync(join(folder, "keep.txt"), "utf8")).toBe("developer work");
  expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => args?.includes("clone"))).toBe(false);
});

it("strips origin userinfo while retaining only the passwordless SSH user git", () => {
  const rows = [
    {
      origin: "https://user:token@example.com/team/api.git",
      remote: "https://example.com/team/api.git",
    },
    {
      origin: "https://token@example.com/team/api.git",
      remote: "https://example.com/team/api.git",
    },
    { origin: "https://git@example.com/team/api.git", remote: "https://example.com/team/api.git" },
    {
      origin: "ssh://user:token@example.com/team/api.git",
      remote: "ssh://example.com/team/api.git",
    },
    { origin: "ssh://alice@example.com/team/api.git", remote: "ssh://example.com/team/api.git" },
    {
      origin: "ssh://git:token@example.com/team/api.git",
      remote: "ssh://example.com/team/api.git",
    },
    { origin: "ssh://git@example.com/team/api.git", remote: "ssh://git@example.com/team/api.git" },
    { origin: "alice@example.com:team/api.git", remote: "example.com:team/api.git" },
    { origin: "user:token@example.com:team/api.git", remote: "example.com:team/api.git" },
    { origin: "git@example.com:team/api.git", remote: "git@example.com:team/api.git" },
    {
      origin: "https://user:token@extra@example.com:8443/team/api.git",
      remote: "https://example.com:8443/team/api.git",
    },
    { origin: "user:token@extra@example.com:team/api.git", remote: "example.com:team/api.git" },
    { origin: "https://example.com/team/api.git", remote: "https://example.com/team/api.git" },
    { origin: "../api.git", remote: "../api.git" },
  ];
  for (const row of rows) {
    expect(sharedRemote(row.origin), row.origin).toBe(row.remote);
    expect(sharedRemote(row.origin)).not.toContain("token");
  }
});

it("rejects unsafe clone remotes before invoking git or creating a destination", () => {
  const rows = [
    "-bad",
    "\\\\host\\share\\api.git",
    "//host/share/api.git",
    "file://host/share/api.git",
  ];
  for (const remote of rows) {
    expect(cloneMissingRepo(project, { ...repo, remote }).ok, remote).toBe(false);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(existsSync(join(project, "apps"))).toBe(false);
  }
});
