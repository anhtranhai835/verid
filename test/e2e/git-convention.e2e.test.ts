import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, runHook } from "./in-process.js";

// The Git rules through the hook, on real throwaway repositories. One case spawns the built hook;
// the tables run it in process.
const ROOT = resolve(import.meta.dirname, "../..");
const HOOK = join(ROOT, "dist", "hook.js");
const SESSION = "git-session";
let project: string;
let gitconfig: string;

const env = (extra: NodeJS.ProcessEnv = {}) => ({
  CLAUDE_PROJECT_DIR: project,
  GIT_CONFIG_GLOBAL: gitconfig,
  GIT_CONFIG_NOSYSTEM: "1",
  ...extra,
});
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env() },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (path: string, text: string) => {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), text);
};
/** A repository with one commit on main, then checked out on `branch`. */
const repoAt = (folder: string, branch: string, main = "main") => {
  const dir = join(project, folder);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", main);
  writeFileSync(join(dir, "readme.txt"), "x");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: start");
  if (branch !== main) git(dir, "switch", "-q", "-c", branch);
  return dir;
};
const manifest = (
  extra = "",
  repos = '  - path: "."\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
) => put(".verid/manifest.yaml", `schemaVersion: 1\nmode: prep\n${extra}repos:\n${repos}`);
const payload = (command: string, cwd = project) =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  });
const prompt = (text: string) =>
  JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: SESSION,
    cwd: project,
    prompt: text,
  });
const code = async (command: string, cwd = project) => {
  const r = await runHook(payload(command, cwd), env());
  return r.code === 0 ? "allow" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
};
const audit = (): Record<string, any>[] =>
  readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const codes = async (rows: string[], cwd = project) =>
  Object.fromEntries(await Promise.all(rows.map(async (r) => [r, await code(r, cwd)] as const)));

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-git-"));
  gitconfig = join(project, "..", `${project.split(/[\\/]/).at(-1)}.gitconfig`);
  writeFileSync(gitconfig, "");
  put(".verid/.state/state.json", '{"schemaVersion":1,"language":"en"}');
  put(".verid/.gitignore", ".state/\n");
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(gitconfig, { force: true });
});

describe("the Git rules through the real hook", () => {
  it("denies a commit on main through the built hook, with the overridable hint", () => {
    manifest();
    repoAt(".", "main");
    const r = spawnSync(process.execPath, [HOOK], {
      input: payload("git commit -m 'feat: x'"),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([k]) => !/^(CLAUDE|GIT_)/.test(k)),
        ),
        ...env(),
      },
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_GIT_MAIN_COMMIT]");
    expect(r.stderr).toContain("/verid tip");
  });

  it("denies main commits and badly named work branches, and lets agreed work branches commit", async () => {
    manifest();
    const results: Record<string, string> = {};
    for (const branch of [
      "main",
      "signup",
      "feature/a",
      "feat/a",
      "fix/a",
      "chore/a",
      "docs/a",
      "refactor/a",
      "test/a",
    ]) {
      repoAt(".", branch);
      results[`${branch}: commit`] = await code("git commit -m 'feat: x'");
      if (branch === "main") results["main: amend"] = await code("git commit --amend --no-edit");
      rmSync(join(project, ".git"), { recursive: true, force: true });
    }
    repoAt(".", "main");
    results["create feat/"] = await code("git switch -c feat/");
    results["create feat/x"] = await code("git switch -c feat/x");
    expect(results).toEqual({
      "main: commit": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: amend": "VERID_BURNT_GIT_MAIN_COMMIT",
      "signup: commit": "VERID_BURNT_GIT_BRANCH_NAME",
      "feature/a: commit": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: commit": "allow",
      "fix/a: commit": "allow",
      "chore/a: commit": "allow",
      "docs/a: commit": "allow",
      "refactor/a: commit": "allow",
      "test/a: commit": "allow",
      "create feat/": "VERID_BURNT_GIT_BRANCH_NAME",
      "create feat/x": "allow",
    });
  }, 60_000); // nine throwaway repositories: slow on a busy machine

  it("judges the repository a literal path, cd or wrapper reaches, not the project's", async () => {
    manifest(
      "",
      '  - path: "api"\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n  - path: "my web"\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
    );
    repoAt("api", "main");
    repoAt("my web", "main");
    repoAt("ok", "feat/a");
    expect(
      await codes([
        "git -C api commit -m x",
        'git -C "my web" commit -m x',
        "command git -C api commit -m x",
        "env X=1 git -C api commit -m x",
        "cd api; git commit -m x",
        "cd ok && git commit -m x",
        "git -C ok switch main && git -C ok commit -m x",
        'echo "git -C api commit"',
        "git -C ok commit -m 'feat: x'",
      ]),
    ).toEqual({
      "git -C api commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      'git -C "my web" commit -m x': "VERID_BURNT_GIT_MAIN_COMMIT",
      "command git -C api commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "env X=1 git -C api commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "cd api; git commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "cd ok && git commit -m x": "allow",
      "git -C ok switch main && git -C ok commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      'echo "git -C api commit"': "allow",
      "git -C ok commit -m 'feat: x'": "allow",
    });
  });

  it("denies every push that reaches a protected ref, and allows the work branch itself", async () => {
    manifest('git:\n  protected_refs: ["refs/heads/release"]\n');
    repoAt(".", "feat/a");
    expect(
      await codes([
        "git push origin HEAD:main",
        "git push origin +HEAD:refs/heads/main",
        "git push origin :main",
        "git push --delete origin main",
        "git push --all origin",
        "git push --mirror origin",
        "git push origin 'refs/heads/*:refs/heads/*'",
        "git push origin HEAD:refs/heads/release",
        "git push origin HEAD:refs/heads/feat/a",
        "git push -u origin feat/a",
        "git push origin HEAD:wip",
      ]),
    ).toEqual({
      "git push origin HEAD:main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push origin +HEAD:refs/heads/main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push origin :main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push --delete origin main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push --all origin": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push --mirror origin": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push origin 'refs/heads/*:refs/heads/*'": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push origin HEAD:refs/heads/release": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "git push origin HEAD:refs/heads/feat/a": "allow",
      "git push -u origin feat/a": "allow",
      "git push origin HEAD:wip": "VERID_BURNT_GIT_BRANCH_NAME",
    });
  });

  it("resolves main from the manifest, origin/HEAD or the sole main, and refuses what it cannot tell", async () => {
    const results: Record<string, string> = {};
    const fresh = () => rmSync(join(project, ".git"), { recursive: true, force: true });
    manifest("git:\n  default_branch: trunk\n");
    repoAt(".", "trunk", "trunk");
    results["root trunk"] = await code("git commit -m x");
    fresh();
    manifest();
    repoAt(".", "feat/a", "master");
    git(project, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(project, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    results["origin/HEAD names main"] = await code("git push origin HEAD:main");
    fresh();
    repoAt(".", "main");
    results["sole main"] = await code("git commit -m x");
    git(project, "branch", "master");
    results["main and master"] = await code("git commit -m x");
    git(project, "switch", "-q", "--detach");
    results.detached = await code("git commit -m x");
    fresh();
    results["not a repository"] = await code("git commit -m x");
    repoAt(".", "feat/a");
    writeFileSync(join(project, ".git", "config"), "[core\nbroken");
    results["broken config"] = await code("git commit -m x");
    expect(results).toEqual({
      "root trunk": "VERID_BURNT_GIT_MAIN_COMMIT",
      "origin/HEAD names main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "sole main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main and master": "VERID_BURNT_GIT_UNRESOLVED",
      detached: "VERID_BURNT_GIT_UNRESOLVED",
      "not a repository": "VERID_BURNT_GIT_UNRESOLVED",
      "broken config": "VERID_BURNT_GIT_UNRESOLVED",
    });
  });

  it("refuses Git it cannot resolve, and judges nothing without a manifest", async () => {
    manifest();
    repoAt(".", "feat/a");
    const refused = await codes([
      'git -C "$repo" commit -m x',
      "GIT_DIR=.git git commit -m x",
      "git -c user.name=x commit -m x",
      "git push --frobnicate origin HEAD",
      'git status && git -C "$x" push',
    ]);
    rmSync(join(project, ".verid", "manifest.yaml"));
    git(project, "switch", "-q", "main");
    expect({ ...refused, "no manifest": await code("git commit -m x") }).toEqual({
      'git -C "$repo" commit -m x': "VERID_BURNT_GIT_UNRESOLVED",
      "GIT_DIR=.git git commit -m x": "VERID_BURNT_GIT_INTERNALS",
      "git -c user.name=x commit -m x": "VERID_BURNT_GIT_UNRESOLVED",
      "git push --frobnicate origin HEAD": "VERID_BURNT_GIT_UNRESOLVED",
      'git status && git -C "$x" push': "VERID_BURNT_GIT_UNRESOLVED",
      "no manifest": "allow",
    });
  });

  it("keeps every older denial, and lifts only the rule the developer overrode, once", async () => {
    manifest();
    repoAt(".", "main");
    const before = await codes([
      "git commit -m x .env",
      "git -C .verid/.state commit",
      "git commit -m x && cat .verid/manifest.yaml",
      "git -c a=b commit -m x && cat .verid/manifest.yaml",
      "git push origin HEAD:refs/heads/feat/a && claude -p hi",
    ]);
    // The developer overrides the main commit: the same call passes once, then is denied again.
    const command = "git commit -m 'feat: x'";
    const first = await code(command);
    const tip = await runHook(
      prompt("/verid tip bootstrap"),
      env({ CLAUDE_CODE_SESSION_ATTENDED: "1" }),
    );
    const shown = /([A-HJ-NP-Z2-9]{6})/.exec(tip.stderr)?.[1] ?? "";
    await runHook(prompt(`/verid confirm ${shown}`), env({ CLAUDE_CODE_SESSION_ATTENDED: "1" }));
    const once = await code(command);
    const again = await code(command);
    // An override of the main rule does not lift the branch-name rule on another call.
    git(project, "switch", "-q", "-c", "wip");
    const unattended = await runHook(
      prompt("/verid tip x"),
      env({ CLAUDE_CODE_SESSION_ATTENDED: "0" }),
    );
    expect({
      ...before,
      first,
      once,
      again,
      "badly named": await code(command),
      unattended: /verid \[(\w+)\]/.exec(unattended.stderr)?.[1],
      audit: readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8").includes(
        '"rule":"VERID_BURNT_GIT_MAIN_COMMIT"',
      ),
    }).toEqual({
      "git commit -m x .env": "VERID_BURNT_SECRET_PROTECTED",
      "git -C .verid/.state commit": "VERID_BURNT_STATE_PROTECTED",
      "git commit -m x && cat .verid/manifest.yaml": "VERID_BURNT_MANIFEST_PROTECTED",
      "git -c a=b commit -m x && cat .verid/manifest.yaml": "VERID_BURNT_GIT_UNRESOLVED",
      "git push origin HEAD:refs/heads/feat/a && claude -p hi": "VERID_BURNT_BASH_NESTED_CLAUDE",
      first: "VERID_BURNT_GIT_MAIN_COMMIT",
      once: "allow",
      again: "VERID_BURNT_GIT_MAIN_COMMIT",
      "badly named": "VERID_BURNT_GIT_BRANCH_NAME",
      unattended: "VERID_BURNT_OVERRIDE_UNATTENDED",
      audit: true,
    });
  });

  it("refuses any write inside a repository's .git folder, by file tool or shell", async () => {
    manifest();
    repoAt(".", "feat/a");
    const write = async (file: string) => {
      const r = await runHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: project,
          tool_name: "Write",
          tool_input: { file_path: join(project, file), content: "x" },
        }),
        env(),
      );
      return r.code === 0 ? "allow" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
    };
    expect({
      ref: await write(".git/refs/heads/main"),
      config: await write(".git/config"),
      gitignore: await write(".gitignore"),
      redirect: await code("echo x > .git/HEAD"),
      hooks: await code("cp evil .git/hooks/pre-commit"),
    }).toEqual({
      ref: "VERID_BURNT_GIT_INTERNALS",
      config: "VERID_BURNT_GIT_INTERNALS",
      gitignore: "allow",
      redirect: "VERID_BURNT_GIT_INTERNALS",
      hooks: "VERID_BURNT_GIT_INTERNALS",
    });
  });

  it("refuses shell commands that name a path inside .git, and writes to Git's global config", async () => {
    manifest();
    repoAt(".", "feat/a");
    const home = join(project, "home");
    const write = async (file: string) => {
      const r = await runHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: SESSION,
          cwd: project,
          tool_name: "Write",
          tool_input: { file_path: file, content: "x" },
        }),
        env(),
      );
      return r.code === 0 ? "allow" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
    };
    expect({
      "cd into .git": await code("cd .git && printf x > HEAD"),
      "hard link": await code("ln -f .git/refs/heads/main m"),
      "read .git": await code("cat .git/HEAD"),
      gitignore: await code("cat .gitignore"),
      "global gitconfig": await write(join(home, ".gitconfig")),
      "xdg git config": await write(join(home, ".config", "git", "config")),
      "shell gitconfig": await code("echo x >> ~/.gitconfig"),
    }).toEqual({
      "cd into .git": "VERID_BURNT_GIT_INTERNALS",
      "hard link": "VERID_BURNT_GIT_INTERNALS",
      "read .git": "VERID_BURNT_GIT_INTERNALS",
      gitignore: "allow",
      "global gitconfig": "VERID_BURNT_GIT_INTERNALS",
      "xdg git config": "VERID_BURNT_GIT_INTERNALS",
      "shell gitconfig": "VERID_BURNT_GIT_INTERNALS",
    });
  });

  it("guards a workspace's .verid repository like any other", async () => {
    manifest(
      'layout: "workspace"\n',
      '  - path: "api"\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
    );
    repoAt("api", "feat/a");
    repoAt(".verid", "main");
    const onMain = await codes([
      "git -C .verid commit -m x",
      "cd .verid && git add plan.md && git commit -m plan",
    ]);
    git(join(project, ".verid"), "switch", "-q", "-c", "docs/plan");
    expect({ ...onMain, "docs/plan": await code("git -C .verid commit -m 'docs: plan'") }).toEqual({
      "git -C .verid commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "cd .verid && git add plan.md && git commit -m plan": "VERID_BURNT_GIT_MAIN_COMMIT",
      "docs/plan": "allow",
    });
  });
});

describe("module history at order and serve", () => {
  const cli = (...args: string[]) => runCli(args, project, env());
  const state = () => JSON.parse(readFileSync(join(project, ".verid/.state/state.json"), "utf8"));
  const setState = (s: unknown) => put(".verid/.state/state.json", JSON.stringify(s));
  const ROLES = 'roles:\n  reviewer: ["verid:reviewer"]\n';
  const project_ = (layout = "", repos?: string) => {
    manifest(`${layout}${ROLES}`, repos);
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    put(".verid/plan.md", "## Module: calc\n- AC-1: sums\n");
  };
  const review = () =>
    runHook(
      JSON.stringify({
        hook_event_name: "SubagentStop",
        session_id: SESSION,
        cwd: project,
        agent_id: "r1",
        agent_type: "verid:reviewer",
        last_assistant_message: "Verdict: pass",
      }),
      env(),
    );
  // Tests passed for every AC, with no change since: what serve checks before Git.
  const tested = () => {
    const s = state();
    setState({
      ...s,
      tdd: { ...s.tdd, state: "PLATED", last_run: "run1", dirty: false, passed_acs: ["AC-1"] },
    });
  };
  const commit = (cwd: string, message: string) => {
    writeFileSync(join(cwd, `${Math.random()}.txt`), "x");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", message);
  };
  const sha = (cwd: string, ref = "HEAD") => git(cwd, "rev-parse", ref);
  const served = async () => {
    const r = await cli("serve", "calc");
    return r.code === 0 ? "served" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
  };
  const API = '  - path: "api"\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n';

  it("records where each Git root's work begins at order, and keeps it on a re-order", async () => {
    const rows: Record<string, unknown> = {};
    project_("", `${API}${API.replace("api", "web")}`);
    repoAt(".", "main");
    mkdirSync(join(project, "api"));
    mkdirSync(join(project, "web"));
    const start = sha(project);
    expect(await cli("order", "calc")).toMatchObject({ code: 0, stderr: "" });
    rows["monorepo, two paths"] = state().modules.calc.work;
    commit(project, "chore: main moves on");
    put(".verid/plan.md", "## Module: calc\n- AC-1: sums\n- AC-2: subtracts\n");
    expect(await cli("order", "calc")).toMatchObject({ code: 0, stderr: "" });
    rows["re-order keeps the base"] = state().modules.calc.work["."].base === start;
    rmSync(join(project, ".git"), { recursive: true, force: true });
    setState({ schemaVersion: 1, language: "en" });
    expect(await cli("order", "calc")).toMatchObject({ code: 0, stderr: "" });
    rows["outside git"] = state().modules.calc.work;
    git(project, "init", "-q", "-b", "main");
    setState({ schemaVersion: 1, language: "en" });
    const unborn = await cli("order", "calc");
    rows["unborn main"] = /verid \[(\w+)\]/.exec(unborn.stderr)?.[1];
    expect(rows).toEqual({
      "monorepo, two paths": { ".": { main: "main", base: start } },
      "re-order keeps the base": true,
      "outside git": {},
      "unborn main": "VERID_BURNT_GIT_WORK_BASE",
    });
  });

  it("records a workspace's child repos and its .verid repo as separate roots", async () => {
    project_('layout: "workspace"\n', API);
    const api = repoAt("api", "main");
    const verid = repoAt(".verid", "main");
    expect(await cli("order", "calc")).toMatchObject({ code: 0, stderr: "" });
    expect(state().modules.calc.work).toEqual({
      api: { main: "main", base: sha(api) },
      ".verid": { main: "main", base: sha(verid) },
    });
  });

  it("serves only when every message since the base is a Conventional Commit, and counts extra commits", async () => {
    const rows: Record<string, string> = {};
    const setup = async () => {
      rmSync(join(project, ".git"), { recursive: true, force: true });
      setState({ schemaVersion: 1, language: "en" });
      repoAt(".", "main");
      expect(await cli("order", "calc")).toMatchObject({ code: 0, stderr: "" });
      git(project, "switch", "-q", "-c", "feat/calc");
    };
    project_();
    await setup();
    commit(project, "feat(calc): add sums");
    tested();
    await review();
    const one = await cli("serve", "calc");
    rows["one commit"] = `${one.code} ${one.stdout.includes("2 commits")}`;
    await setup();
    commit(project, "feat(calc): add sums");
    commit(project, "fix(calc): handle zero");
    tested();
    await review();
    const two = await cli("serve", "calc");
    rows["two commits"] = `${two.code} ${two.stdout.includes("2 commits")}`;
    await setup();
    commit(project, "wip");
    commit(project, "feat(calc): add sums");
    tested();
    await review();
    rows["earlier bad message"] = await served();
    await setup();
    commit(project, "feat(calc): add sums");
    git(project, "commit", "--amend", "-q", "-m", "add sums");
    tested();
    await review();
    rows["amended to a bad message"] = await served();
    await setup();
    git(project, "checkout", "-q", "--orphan", "feat/other");
    commit(project, "feat: unrelated");
    tested();
    await review();
    rows["work not from the base"] = await served();
    await setup();
    const s = state();
    delete s.modules.calc.work;
    setState(s);
    commit(project, "feat(calc): add sums");
    tested();
    await review();
    rows["ordered before bases"] = await served();
    expect(rows).toEqual({
      "one commit": "0 false",
      "two commits": "0 true",
      "earlier bad message": "VERID_BURNT_GIT_COMMIT_MESSAGE",
      "amended to a bad message": "VERID_BURNT_GIT_COMMIT_MESSAGE",
      "work not from the base": "VERID_BURNT_GIT_WORK_BASE",
      "ordered before bases": "VERID_BURNT_GIT_WORK_BASE",
    });
  }, 60_000); // six orders, commits and reviews in real repositories: slow on a busy machine

  it("refuses to serve when Git appeared after an order made outside it", async () => {
    project_();
    expect((await cli("order", "calc")).code).toBe(0);
    repoAt(".", "main");
    tested();
    await review();
    expect(await served()).toBe("VERID_BURNT_GIT_WORK_BASE");
  });

  it("asks for a new review once the work changed after it, and says when there is no Git history", async () => {
    project_();
    repoAt(".", "main");
    expect(await cli("order", "calc")).toMatchObject({ code: 0, stderr: "" });
    git(project, "switch", "-q", "-c", "feat/calc");
    commit(project, "feat(calc): add sums");
    tested();
    await review();
    commit(project, "fix(calc): late change");
    const stale = await cli("serve", "calc");
    writeFileSync(join(project, "readme.txt"), "changed after the review");
    await review();
    writeFileSync(join(project, "readme.txt"), "changed again");
    const dirty = await cli("serve", "calc");
    rmSync(join(project, ".git"), { recursive: true, force: true });
    setState({ schemaVersion: 1, language: "en" });
    expect(await cli("order", "calc")).toMatchObject({ code: 0, stderr: "" });
    tested();
    await review();
    const outside = await cli("serve", "calc");
    expect({
      "new commit": stale.stderr.includes("review it again"),
      "uncommitted change": dirty.stderr.includes("review it again"),
      "outside git": `${outside.code} ${outside.stdout.includes("no Git history")}`,
    }).toEqual({ "new commit": true, "uncommitted change": true, "outside git": "0 true" });
  });
});

describe("verid menu --commits: the module's work history for the reviewer", () => {
  it("prints every commit since the base with its message and diff, and the uncommitted diff, never secrets", async () => {
    manifest('roles:\n  reviewer: ["verid:reviewer"]\n');
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    put(".verid/plan.md", "## Module: calc\n- AC-1: sums\n");
    repoAt(".", "main");
    const before = await runCli(["menu", "--commits"], project, env());
    expect((await runCli(["order", "calc"], project, env())).code).toBe(0);
    git(project, "switch", "-q", "-c", "feat/calc");
    put("src/calc.ts", "export const sum = (a: number) => a + 1;\n");
    put(".env", "TOKEN=hunter2\n");
    put("config/db-credentials.json", '{"password":"swordfish"}\n');
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", "feat(calc): add sums\n\nBody line.");
    put("src/calc.ts", "export const sum = (a: number, b: number) => a + b;\n");
    git(project, "commit", "-q", "-am", "fix(calc): take two numbers");
    put("src/calc.ts", "export const sum = (a: number, b: number) => a + b; // uncommitted\n");
    put(".env", "TOKEN=changed-secret\n");
    put("src/new-secret.pem", "-----BEGIN KEY-----\n");
    const r = await runCli(["menu", "--commits"], project, env());
    expect({
      "before an order": before.stdout.includes("no open module"),
      code: r.code,
      messages: ["feat(calc): add sums", "Body line.", "fix(calc): take two numbers"].every((m) =>
        r.stdout.includes(m),
      ),
      "committed diff": r.stdout.includes("+export const sum = (a: number, b: number) => a + b;"),
      "uncommitted diff": r.stdout.includes("// uncommitted"),
      secrets: ["hunter2", "swordfish", "changed-secret", "BEGIN KEY"].filter((s) =>
        r.stdout.includes(s),
      ),
      "secret files named, not shown": r.stdout.includes(".env"),
      state: r.stdout.includes(".state"),
      "no state change": readFileSync(join(project, ".verid/.state/state.json"), "utf8").includes(
        '"calc"',
      ),
    }).toEqual({
      "before an order": true,
      code: 0,
      messages: true,
      "committed diff": true,
      "uncommitted diff": true,
      secrets: [],
      "secret files named, not shown": false,
      state: false,
      "no state change": true,
    });
  });
});

describe("the auto drive's close reads the same history", () => {
  const ROLES =
    'drive: "auto"\nroles:\n  reviewer: ["verid:reviewer"]\n  tester: ["verid:tester"]\n  coder: ["verid:coder"]\n';
  const lifecycle = (event: string, extra: Record<string, unknown> = {}) =>
    runHook(
      JSON.stringify({
        hook_event_name: event,
        session_id: SESSION,
        cwd: project,
        stop_hook_active: false,
        ...extra,
      }),
      env(),
    );
  const reviewed = () =>
    lifecycle("SubagentStop", {
      agent_id: "r1",
      agent_type: "verid:reviewer",
      last_assistant_message: "Verdict: pass",
    });
  const state = () => JSON.parse(readFileSync(join(project, ".verid/.state/state.json"), "utf8"));
  const commit = (message: string) => {
    writeFileSync(join(project, `${Math.random()}.txt`), "x");
    git(project, "add", "-A");
    git(project, "commit", "-q", "-m", message);
  };

  it("refuses an earlier bad message at the auto close, and closes with an extra commit only noted", async () => {
    manifest(ROLES);
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    put(
      ".verid/plan.md",
      "## Module: calc\n- AC-1: sums\n## Module: product\n- AC-9 (e2e): works\n",
    );
    repoAt(".", "main");
    expect((await runCli(["order"], project, env())).code).toBe(0);
    await reviewed(); // the plan passes: calc opens, and its work begins at main
    const base = state().auto.work;
    git(project, "switch", "-q", "-c", "feat/calc");
    commit("wip");
    commit("feat(calc): add sums");
    const s = state();
    put(
      ".verid/.state/state.json",
      JSON.stringify({
        ...s,
        tdd: { ...s.tdd, state: "PLATED", last_run: "r1", dirty: false, passed_acs: ["AC-1"] },
      }),
    );
    await reviewed();
    const refused = await lifecycle("Stop");
    git(project, "reset", "-q", "--soft", base.roots["."].base);
    git(project, "commit", "-q", "-m", "feat(calc): add sums");
    commit("fix(calc): handle zero");
    await reviewed();
    const served = audit().find((e) => e.event === "module_served");
    expect({
      "work begins at main": base.roots["."].base === git(project, "rev-parse", "main"),
      "not served on wip": refused.stderr.includes("is not a Conventional Commit"),
      served: served?.module,
      commits: served?.commits,
      "next module's work": state().auto.work?.module,
    }).toEqual({
      "work begins at main": true,
      "not served on wip": true,
      served: "calc",
      commits: [{ repo: ".", commits: 2 }],
      "next module's work": "product",
    });
  }, 60_000); // a signed auto drive in a real repository: slow on a busy machine

  it("keeps an auto module open when Git appeared after its work began outside Git", async () => {
    manifest(ROLES);
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", "# Design\n");
    put(
      ".verid/plan.md",
      "## Module: calc\n- AC-1: sums\n## Module: product\n- AC-9 (e2e): works\n",
    );
    expect((await runCli(["order"], project, env())).code).toBe(0);
    await reviewed(); // the plan passes outside Git: calc's work begins with no root
    repoAt(".", "main");
    git(project, "switch", "-q", "-c", "feat/calc");
    const s = state();
    put(
      ".verid/.state/state.json",
      JSON.stringify({
        ...s,
        tdd: { ...s.tdd, state: "PLATED", last_run: "r1", dirty: false, passed_acs: ["AC-1"] },
      }),
    );
    await reviewed();
    expect(state().modules.calc).toBeUndefined();
  });

  it("judges a Codex shell command with the same Git rules", async () => {
    manifest();
    repoAt(".", "main");
    const r = await runHook(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "codex-session",
        transcript_path: null,
        cwd: project,
        model: "gpt-6-luna",
        permission_mode: "default",
        turn_id: "t1",
        tool_name: "Bash",
        tool_use_id: "u1",
        tool_input: { command: "git commit -m 'feat: x'" },
      }),
      env(),
      ["--provider", "codex"],
    );
    const hidden = await runHook(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "codex-session",
        transcript_path: null,
        cwd: project,
        model: "gpt-6-luna",
        permission_mode: "default",
        turn_id: "t2",
        tool_name: "Bash",
        tool_use_id: "u2",
        tool_input: { command: 'echo "C:\\x\\"; git commit -m "feat: y"' },
      }),
      env(),
      ["--provider", "codex"],
    );
    expect(
      JSON.parse(hidden.stdout || "{}").hookSpecificOutput?.permissionDecisionReason,
    ).toContain("VERID_BURNT_GIT_MAIN_COMMIT");
    const out = JSON.parse(r.stdout || "{}");
    expect([
      r.code,
      out.hookSpecificOutput?.permissionDecision,
      String(out.hookSpecificOutput?.permissionDecisionReason).includes(
        "VERID_BURNT_GIT_MAIN_COMMIT",
      ),
    ]).toEqual([0, "deny", true]);
  });
});
