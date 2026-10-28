import { describe, expect, it } from "vitest";
import type { RuleCode } from "../../src/core/errors.js";
import {
  decideGit,
  gitCalls,
  closeHistory,
  isConventionalCommit,
  isWorkBranch,
  resolveMain,
  type RepoFacts,
} from "../../src/core/git-convention.js";

const repo = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  top: "/r",
  branch: "feat/a",
  main: { ok: true, main: "main" },
  heads: ["main", "feat/a"],
  tags: [],
  remoteBranches: ["origin/main", "origin/wip"],
  config: {},
  ...over,
});
const ON_MAIN = repo({ branch: "main" });

// The code of each denial for a shell line run in one repository, or allow.
const judge = (
  command: string,
  facts: RepoFacts | { error: string } = repo(),
  protectedRefs: string[] = [],
  lifted: RuleCode[] = [],
) => {
  const parsed = gitCalls(command);
  const denied = decideGit(
    parsed,
    parsed.map(() => facts),
    { protectedRefs },
    new Set(lifted),
  );
  return denied.map((d) => (d.kind === "deny" ? d.code : d.kind)).join(" ") || "allow";
};
const judged = (rows: [string, RepoFacts, string?][]) =>
  Object.fromEntries(
    rows.map(([command, facts, label]) => [
      label ?? `${facts.branch}: ${command}`,
      judge(command, facts),
    ]),
  );

// One line per Git call: its folders, its words ($ for a dynamic one), then why it is unresolved.
const calls = (command: string) =>
  gitCalls(command).map(
    (c) =>
      `${c.dirs.join(">")}|${c.args.map((w) => (w.dynamic ? "$" : w.text)).join(" ")}|${c.unresolved ?? ""}|${c.then}`,
  );

describe("commit messages and branch names", () => {
  it("accepts a Conventional Commit header, then an optional body after a blank line", () => {
    const rows = {
      feat: "feat: add signup",
      "scope and bang": "fix(api)!: reject invalid order",
      "other type": "perf: reduce queries",
      "with body": "feat: add signup\n\nWhy it is needed.\n",
      "trailing newline": "docs: explain setup\n",
      crlf: "feat: add signup\r\n\r\nbody\r\n",
      "no type": "add signup",
      "empty scope": "feat(): x",
      "empty description": "feat: ",
      "no space": "feat:add signup",
      "body without blank line": "feat: add signup\nbody",
      merge: "Merge branch 'feat/a'",
      empty: "",
    };
    expect(
      Object.fromEntries(Object.entries(rows).map(([k, m]) => [k, isConventionalCommit(m)])),
    ).toEqual({
      feat: true,
      "scope and bang": true,
      "other type": true,
      "with body": true,
      "trailing newline": true,
      crlf: true,
      "no type": false,
      "empty scope": false,
      "empty description": false,
      "no space": false,
      "body without blank line": false,
      merge: false,
      empty: false,
    });
  });

  it("allows a work branch only with an agreed prefix and a name after it", () => {
    const names = [
      "feat/a",
      "fix/a",
      "chore/a",
      "docs/a",
      "refactor/a",
      "test/a",
      "feat/a/b",
      "signup",
      "feature/a",
      "feat/",
      "Feat/a",
      "main",
    ];
    expect(Object.fromEntries(names.map((n) => [n, isWorkBranch(n)]))).toEqual({
      "feat/a": true,
      "fix/a": true,
      "chore/a": true,
      "docs/a": true,
      "refactor/a": true,
      "test/a": true,
      "feat/a/b": true,
      signup: false,
      "feature/a": false,
      "feat/": false,
      "Feat/a": false,
      main: false,
    });
  });
});

describe("gitCalls: the Git commands a shell line runs, read as the shell would", () => {
  it("finds each literal Git call with the folders it runs from", () => {
    const rows = [
      "git -C api commit -m x",
      'git -C "my repo" commit',
      "command git commit",
      "env X=1 git commit",
      "cd api; git commit",
      "cd api && git -C web commit",
      "git switch main && git commit",
      "/usr/bin/git push origin HEAD",
      '"C:/Program Files/Git/cmd/git.exe" commit',
      "Git.exe status",
      "git --no-pager -C api log | head",
      "git commit -m x > out.txt 2>&1",
      "git \\\ncommit",
      'echo "git commit"',
      'git commit -m "a; git push origin main"',
      "git commit -F - <<'EOF'\nfeat: x\n\ngit push origin main\nEOF\ngit status",
      "npm test # git commit",
      "git --version",
    ];
    expect(Object.fromEntries(rows.map((r) => [r, calls(r)]))).toEqual({
      "git -C api commit -m x": ["api|commit -m x||"],
      'git -C "my repo" commit': ["my repo|commit||"],
      "command git commit": ["|commit||"],
      "env X=1 git commit": ["|commit||"],
      "cd api; git commit": ["api|commit||"],
      "cd api && git -C web commit": ["api>web|commit||"],
      "git switch main && git commit": ["|switch main||&&", "|commit||"],
      "/usr/bin/git push origin HEAD": ["|push origin HEAD||"],
      '"C:/Program Files/Git/cmd/git.exe" commit': ["|commit||"],
      "Git.exe status": ["|status||"],
      "git --no-pager -C api log | head": ["api|log|||"],
      "git commit -m x > out.txt 2>&1": ["|commit -m x||"],
      "git \\\ncommit": ["|commit||"],
      'echo "git commit"': [],
      'git commit -m "a; git push origin main"': ["|commit -m a; git push origin main||"],
      "git commit -F - <<'EOF'\nfeat: x\n\ngit push origin main\nEOF\ngit status": [
        "|commit -F -||\n",
        "|status||",
      ],
      "npm test # git commit": [],
      "git --version": [],
    });
  });

  it("marks a Git call unresolved when its folder, repository or flow cannot be read literally", () => {
    const rows = [
      'git -C "$repo" commit',
      "git -C ~/x commit",
      "git -C C:\\repo commit",
      "GIT_DIR=x git commit",
      "export GIT_WORK_TREE=/x; git commit",
      "$env:GIT_DIR='x'; git commit",
      "git -c user.name=x commit",
      "git --git-dir=x commit",
      "git --work-tree x commit",
      "env -C api git commit",
      "git $sub",
      "cd $X && git commit",
      "cd api | git commit",
      "cd api || git commit",
      "cd && git commit",
      "popd; git commit",
      "if true; then git commit; fi",
      "(cd api && git commit)",
      "f() { git push; }; f",
    ];
    expect(Object.fromEntries(rows.map((r) => [r, calls(r).map((c) => c.split("|")[2])]))).toEqual({
      'git -C "$repo" commit': ["dynamic folder"],
      "git -C ~/x commit": ["dynamic folder"],
      "git -C C:\\repo commit": ["dynamic folder"],
      "GIT_DIR=x git commit": ["git environment"],
      "export GIT_WORK_TREE=/x; git commit": ["git environment"],
      "$env:GIT_DIR='x'; git commit": ["git environment"],
      "git -c user.name=x commit": ["git option -c"],
      "git --git-dir=x commit": ["git option --git-dir=x"],
      "git --work-tree x commit": ["git option --work-tree"],
      "env -C api git commit": ["wrapper option"],
      "git $sub": ["dynamic command"],
      "cd $X && git commit": ["working folder"],
      "cd api | git commit": ["working folder"],
      "cd api || git commit": ["working folder"],
      "cd && git commit": ["working folder"],
      "popd; git commit": ["working folder"],
      "if true; then git commit; fi": ["control flow"],
      "(cd api && git commit)": ["control flow"],
      "f() { git push; }; f": ["control flow"],
    });
  });
});

describe("decideGit: the Git rules on what a shell line does", () => {
  it("denies commits and history changes on main, and commits on badly named branches", () => {
    const detached = repo({ branch: null });
    expect(
      judged([
        ["git commit -m x", ON_MAIN],
        ["git commit --amend --no-edit", ON_MAIN],
        ["git merge feat/a", ON_MAIN],
        ["git pull", ON_MAIN],
        ["git rebase feat/a", ON_MAIN],
        ["git cherry-pick abc", ON_MAIN],
        ["git revert abc", ON_MAIN],
        ["git am x.patch", ON_MAIN],
        ["git reset --hard origin/main", ON_MAIN],
        ["git merge --abort", ON_MAIN],
        ["git reset --hard", ON_MAIN],
        ["git reset -- a.ts", ON_MAIN],
        ["git status", ON_MAIN],
        ["git commit -m x", repo({ branch: "feature/a" })],
        ["git commit -m x", repo({ branch: "signup" })],
        ["git merge main", repo({ branch: "wip" })],
        ["git commit -m x", repo()],
        ["git pull origin main", repo()],
        ["git commit -m x", detached],
        ["git reset --hard origin/main", detached],
        ["git commit -m x", repo({ main: { ok: false, detail: "no main branch" } }), "no main"],
      ]),
    ).toEqual({
      "main: git commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git commit --amend --no-edit": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git merge feat/a": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git pull": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git rebase feat/a": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git cherry-pick abc": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git revert abc": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git am x.patch": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git reset --hard origin/main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git merge --abort": "allow",
      "main: git reset --hard": "allow",
      "main: git reset -- a.ts": "allow",
      "main: git status": "allow",
      "feature/a: git commit -m x": "VERID_BURNT_GIT_BRANCH_NAME",
      "signup: git commit -m x": "VERID_BURNT_GIT_BRANCH_NAME",
      "wip: git merge main": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git commit -m x": "allow",
      "feat/a: git pull origin main": "allow",
      "null: git commit -m x": "VERID_BURNT_GIT_UNRESOLVED",
      "null: git reset --hard origin/main": "allow",
      "no main": "VERID_BURNT_GIT_UNRESOLVED",
    });
  });

  it("freezes the branch of a module that waits for its merge, as it freezes main", () => {
    const frozen = (command: string, facts: RepoFacts, lifted: RuleCode[] = []) => {
      const parsed = gitCalls(command);
      return (
        decideGit(
          parsed,
          parsed.map(() => facts),
          { protectedRefs: [], frozen: "feat/a" },
          new Set(lifted),
        )
          .map((d) => (d.kind === "deny" ? d.code : d.kind))
          .join(" ") || "allow"
      );
    };
    const onB = repo({ branch: "feat/b", heads: ["main", "feat/a", "feat/b"] });
    expect({
      commit: frozen("git commit -m x", repo()),
      amend: frozen("git commit --amend --no-edit", repo()),
      merge: frozen("git merge main", repo()),
      rebase: frozen("git rebase main", repo()),
      "rebase it from main": frozen("git rebase main feat/a", ON_MAIN),
      pull: frozen("git pull", repo()),
      "cherry-pick": frozen("git cherry-pick abc", repo()),
      "reset to a commit": frozen("git reset --hard HEAD~1", repo()),
      "reset the tree": frozen("git reset --hard", repo()),
      status: frozen("git status", repo()),
      "switch to main": frozen("git switch main", repo()),
      "switch then commit": frozen("git switch feat/a && git commit -m x", onB),
      "another branch": frozen("git commit -m x", onB),
      "force it": frozen("git branch -f feat/a main", onB),
      "switch -C": frozen("git switch -C feat/a", onB),
      "checkout -B": frozen("git checkout -B feat/a main", onB),
      "update-ref": frozen("git update-ref refs/heads/feat/a HEAD", onB),
      "fetch into it": frozen("git fetch origin main:feat/a", onB),
      "push . into it": frozen("git push . main:feat/a", onB),
      "rename it": frozen("git branch -m feat/a feat/z", onB),
      "delete it": frozen("git branch -D feat/a", onB),
      "push it to origin": frozen("git push origin feat/a", onB),
      "push ./ into it": frozen("git push ./ feat/b:feat/a", onB),
      "push another branch over it": frozen("git push origin feat/b:feat/a", onB),
      "delete it on origin": frozen("git push origin :feat/a", onB),
      "push it from itself": frozen("git push", repo()),
      "main still": frozen("git pull", ON_MAIN),
      tipped: frozen("git commit -m x", repo(), ["VERID_BURNT_AUTO_WAITING_MERGE"]),
    }).toEqual({
      commit: "VERID_BURNT_AUTO_WAITING_MERGE",
      amend: "VERID_BURNT_AUTO_WAITING_MERGE",
      merge: "VERID_BURNT_AUTO_WAITING_MERGE",
      rebase: "VERID_BURNT_AUTO_WAITING_MERGE",
      "rebase it from main": "VERID_BURNT_AUTO_WAITING_MERGE",
      pull: "VERID_BURNT_AUTO_WAITING_MERGE",
      "cherry-pick": "VERID_BURNT_AUTO_WAITING_MERGE",
      "reset to a commit": "VERID_BURNT_AUTO_WAITING_MERGE",
      "reset the tree": "allow",
      status: "allow",
      "switch to main": "allow",
      "switch then commit": "VERID_BURNT_AUTO_WAITING_MERGE",
      "another branch": "allow",
      "force it": "VERID_BURNT_AUTO_WAITING_MERGE",
      "switch -C": "VERID_BURNT_AUTO_WAITING_MERGE",
      "checkout -B": "VERID_BURNT_AUTO_WAITING_MERGE",
      "update-ref": "VERID_BURNT_AUTO_WAITING_MERGE",
      "fetch into it": "VERID_BURNT_AUTO_WAITING_MERGE",
      "push . into it": "VERID_BURNT_AUTO_WAITING_MERGE",
      "rename it": "VERID_BURNT_AUTO_WAITING_MERGE",
      "delete it": "VERID_BURNT_AUTO_WAITING_MERGE",
      "push it to origin": "VERID_BURNT_AUTO_WAITING_MERGE",
      "push ./ into it": "VERID_BURNT_AUTO_WAITING_MERGE",
      "push another branch over it": "VERID_BURNT_AUTO_WAITING_MERGE",
      "delete it on origin": "VERID_BURNT_AUTO_WAITING_MERGE",
      "push it from itself": "VERID_BURNT_AUTO_WAITING_MERGE",
      "main still": "VERID_BURNT_GIT_MAIN_COMMIT",
      tipped: "allow",
    });
  });

  it("denies writes to main's ref and badly named new branches from any branch", () => {
    expect(
      judged([
        ["git branch -f main HEAD", repo()],
        ["git branch -D main", repo()],
        ["git branch -m main feat/x", repo()],
        ["git update-ref refs/heads/main HEAD", repo()],
        ["git update-ref HEAD abc", ON_MAIN],
        ["git checkout -B main", repo()],
        ["git switch -C main origin/main", repo()],
        ["git checkout -b main", repo()],
        ["git fetch origin main:main", repo()],
        ["git fetch . feat/a:refs/heads/main", repo()],
        ["git pull origin main:main", repo()],
        ["git switch -c feature/x", ON_MAIN],
        ["git checkout -b signup", ON_MAIN],
        ["git branch wip", repo()],
        ["git branch -m wip", repo()],
        ["git checkout wip", repo()],
        ["git worktree add -b x ../x", repo()],
        ["git worktree add ../x", repo()],
        ["git stash branch x", repo()],
        ["git switch -c feat/x", ON_MAIN],
        ["git checkout -b fix/y origin/main", ON_MAIN],
        ["git branch docs/z", repo()],
        ["git checkout main", repo()],
        ["git switch main", repo()],
        ["git branch -a", repo()],
        ["git branch -d feat/a", ON_MAIN],
        ["git fetch origin", repo()],
        ["git fetch origin main", repo()],
        ["git worktree add ../w feat/a", repo()],
      ]),
    ).toEqual({
      "feat/a: git branch -f main HEAD": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git branch -D main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git branch -m main feat/x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git update-ref refs/heads/main HEAD": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git update-ref HEAD abc": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git checkout -B main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git switch -C main origin/main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git checkout -b main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git fetch origin main:main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git fetch . feat/a:refs/heads/main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git pull origin main:main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git switch -c feature/x": "VERID_BURNT_GIT_BRANCH_NAME",
      "main: git checkout -b signup": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git branch wip": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git branch -m wip": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git checkout wip": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git worktree add -b x ../x": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git worktree add ../x": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git stash branch x": "VERID_BURNT_GIT_BRANCH_NAME",
      "main: git switch -c feat/x": "allow",
      "main: git checkout -b fix/y origin/main": "allow",
      "feat/a: git branch docs/z": "allow",
      "feat/a: git checkout main": "allow",
      "feat/a: git switch main": "allow",
      "feat/a: git branch -a": "allow",
      "main: git branch -d feat/a": "allow",
      "feat/a: git fetch origin": "allow",
      "feat/a: git fetch origin main": "allow",
      "feat/a: git worktree add ../w feat/a": "allow",
    });
  });

  it("judges a later command on the branch an earlier one leaves, or refuses when that is unclear", () => {
    expect(
      judged([
        ["git switch main && git commit -m x", repo()],
        ["git checkout main && git push origin HEAD", repo()],
        ["git switch -c feat/x && git commit -m x", ON_MAIN],
        ["git checkout -b feat/x && git add -A && git commit -m x", ON_MAIN],
        ["git switch -c feat/x; git commit -m x", ON_MAIN],
        ["git switch -c feat/x || git commit -m x", ON_MAIN],
        ["git branch -m feat/b && git commit -m x", repo()],
        ["git checkout HEAD~1 && git commit -m x", repo()],
        ["git switch --detach && git commit -m x", repo()],
        ["git config push.default matching && git push", repo()],
        ["git branch -u origin/main && git push", repo()],
        ["git switch -c feat/x && git status", ON_MAIN],
      ]),
    ).toEqual({
      "feat/a: git switch main && git commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git checkout main && git push origin HEAD": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "main: git switch -c feat/x && git commit -m x": "allow",
      "main: git checkout -b feat/x && git add -A && git commit -m x": "allow",
      "main: git switch -c feat/x; git commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git switch -c feat/x || git commit -m x": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git branch -m feat/b && git commit -m x": "allow",
      "feat/a: git checkout HEAD~1 && git commit -m x": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git switch --detach && git commit -m x": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git config push.default matching && git push": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git branch -u origin/main && git push": "VERID_BURNT_GIT_UNRESOLVED",
      "main: git switch -c feat/x && git status": "allow",
    });
  });

  it("resolves every push destination offline and denies protected refs and badly named branches", () => {
    const upstream = (merge?: string) =>
      repo({
        config: {
          "push.default": ["upstream"],
          ...(merge && { "branch.feat/a.merge": [merge] }),
        },
      });
    expect(
      judged([
        ["git push origin HEAD:main", repo()],
        ["git push origin +HEAD:refs/heads/main", repo()],
        ["git push origin :main", repo()],
        ["git push --delete origin main", repo()],
        ["git push -d origin main", repo()],
        ["git push --all origin", repo()],
        ["git push --mirror origin", repo()],
        ["git push origin 'refs/heads/*:refs/heads/*'", repo()],
        ["git push origin 'refs/heads/feat/*:refs/heads/feat/*'", repo()],
        ["git push --prune origin 'refs/heads/feat/*:refs/heads/feat/*'", repo()],
        ["git push origin main", repo()],
        ["git push origin HEAD", ON_MAIN],
        ["git push", ON_MAIN],
        ["git push origin HEAD:refs/heads/feat/a", repo()],
        ["git push -u origin feat/a", repo()],
        ["git push --force-with-lease origin HEAD", repo()],
        ["git push -o ci.skip origin feat/a", repo()],
        ["git push", repo()],
        ["git push origin", repo()],
        ["git push origin HEAD:wip", repo()],
        ["git push origin HEAD:refs/heads/wip", repo()],
        ["git push origin tag v1", repo()],
        ["git push", upstream("refs/heads/main"), "upstream main"],
        ["git push", upstream("refs/heads/feat/a"), "upstream feat/a"],
        ["git push", upstream(), "upstream unset"],
        ["git push", repo({ config: { "push.default": ["matching"] } }), "matching"],
        [
          "git push",
          repo({ config: { "remote.origin.push": ["refs/heads/*:refs/heads/*"] } }),
          "configured push refspec",
        ],
        [
          "git push origin feat/a",
          repo({ config: { "remote.origin.push": ["HEAD"] } }),
          "source only with a configured push refspec",
        ],
        ["git push", repo({ config: { "remote.origin.mirror": ["true"] } }), "mirror remote"],
        ["git push", repo({ branch: null })],
        ["git push origin HEAD", repo({ branch: null })],
        ["git push origin HEAD:refs/heads/feat/a", repo({ branch: null })],
        ["git push --frobnicate origin HEAD", repo()],
        ["git push --repo=origin", repo()],
        ["git push origin $B", repo()],
        ["git push . HEAD:main", repo()],
      ]),
    ).toEqual({
      "feat/a: git push origin HEAD:main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push origin +HEAD:refs/heads/main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push origin :main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push --delete origin main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push -d origin main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push --all origin": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push --mirror origin": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push origin 'refs/heads/*:refs/heads/*'": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push origin 'refs/heads/feat/*:refs/heads/feat/*'": "allow",
      "feat/a: git push --prune origin 'refs/heads/feat/*:refs/heads/feat/*'":
        "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push origin main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "main: git push origin HEAD": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "main: git push": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push origin HEAD:refs/heads/feat/a": "allow",
      "feat/a: git push -u origin feat/a": "allow",
      "feat/a: git push --force-with-lease origin HEAD": "allow",
      "feat/a: git push -o ci.skip origin feat/a": "allow",
      "feat/a: git push": "allow",
      "feat/a: git push origin": "allow",
      "feat/a: git push origin HEAD:wip": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git push origin HEAD:refs/heads/wip": "VERID_BURNT_GIT_BRANCH_NAME",
      "feat/a: git push origin tag v1": "allow",
      "upstream main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "upstream feat/a": "allow",
      "upstream unset": "VERID_BURNT_GIT_UNRESOLVED",
      matching: "VERID_BURNT_GIT_PROTECTED_PUSH",
      "configured push refspec": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "source only with a configured push refspec": "VERID_BURNT_GIT_UNRESOLVED",
      "mirror remote": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "null: git push": "VERID_BURNT_GIT_UNRESOLVED",
      "null: git push origin HEAD": "VERID_BURNT_GIT_UNRESOLVED",
      "null: git push origin HEAD:refs/heads/feat/a": "allow",
      "feat/a: git push --frobnicate origin HEAD": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git push --repo=origin": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git push origin $B": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git push . HEAD:main": "VERID_BURNT_GIT_PROTECTED_PUSH",
    });
  });
});

describe("decideGit: refusals that keep verid conservative", () => {
  it("adds the manifest's protected refs to main, exactly and never by pattern", () => {
    const release = ["refs/heads/release", "refs/tags/v1"];
    expect({
      "release branch": judge("git push origin HEAD:refs/heads/release", repo(), release),
      "short release": judge("git push origin HEAD:release", repo(), release),
      "protected tag": judge("git push origin tag v1", repo(), release),
      "tags option": judge("git push --tags origin", repo({ tags: ["v1"] }), release),
      "other tag": judge("git push origin tag v2", repo(), release),
      "release-2": judge("git push origin HEAD:refs/heads/release-2", repo(), release),
      "main still": judge("git push origin HEAD:main", repo(), release),
    }).toEqual({
      "release branch": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "short release": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "protected tag": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "tags option": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "other tag": "allow",
      "release-2": "VERID_BURNT_GIT_BRANCH_NAME",
      "main still": "VERID_BURNT_GIT_PROTECTED_PUSH",
    });
  });

  it("refuses Git it cannot follow: unreadable facts, aliases, hidden commands, unresolved calls", () => {
    const aliased = repo({ config: { "alias.ship": ["push origin HEAD:main"] } });
    expect({
      "not a repository": judge("git commit -m x", { error: "not a git repository" }),
      "status outside a repository": judge("git status", { error: "not a git repository" }),
      alias: judge("git ship", aliased),
      "unknown without alias": judge("git frobnicate", repo()),
      "filter-branch": judge("git filter-branch --all", repo()),
      "rebase exec": judge("git rebase -x 'git push origin HEAD:main' main", repo()),
      "submodule foreach": judge("git submodule foreach git push", repo()),
      "dynamic folder": judge('git -C "$repo" commit -m x', repo()),
      "selector environment": judge("GIT_DIR=x git commit -m x", repo()),
      "unmodeled -c": judge("git -c user.name=x commit -m x", repo()),
      "unresolved but read-only": judge('git -C "$repo" status', repo()),
      "unresolved add": judge("cd $X && git add -A", repo()),
    }).toEqual({
      "not a repository": "VERID_BURNT_GIT_UNRESOLVED",
      "status outside a repository": "allow",
      alias: "VERID_BURNT_GIT_UNRESOLVED",
      "unknown without alias": "VERID_BURNT_GIT_UNRESOLVED",
      "filter-branch": "VERID_BURNT_GIT_UNRESOLVED",
      "rebase exec": "VERID_BURNT_GIT_UNRESOLVED",
      "submodule foreach": "VERID_BURNT_GIT_UNRESOLVED",
      "dynamic folder": "VERID_BURNT_GIT_UNRESOLVED",
      "selector environment": "VERID_BURNT_GIT_UNRESOLVED",
      "unmodeled -c": "VERID_BURNT_GIT_UNRESOLVED",
      "unresolved but read-only": "allow",
      "unresolved add": "allow",
    });
  });

  it("lifts exactly the overridden rule and judges the others again", () => {
    const lifted = (command: string, facts: RepoFacts, codes: RuleCode[]) =>
      judge(command, facts, [], codes);
    expect({
      "main commit lifted": lifted("git commit -m x", ON_MAIN, ["VERID_BURNT_GIT_MAIN_COMMIT"]),
      "branch name still": lifted("git commit -m x", repo({ branch: "wip" }), [
        "VERID_BURNT_GIT_MAIN_COMMIT",
      ]),
      "push lifted, name still": lifted(
        "git push origin HEAD:main && git push origin HEAD:wip",
        repo(),
        ["VERID_BURNT_GIT_PROTECTED_PUSH"],
      ),
      "unresolved stays": lifted("git -c a=b commit -m x", ON_MAIN, [
        "VERID_BURNT_GIT_MAIN_COMMIT",
        "VERID_BURNT_GIT_BRANCH_NAME",
        "VERID_BURNT_GIT_PROTECTED_PUSH",
      ]),
    }).toEqual({
      "main commit lifted": "allow",
      "branch name still": "VERID_BURNT_GIT_BRANCH_NAME",
      "push lifted, name still": "VERID_BURNT_GIT_BRANCH_NAME",
      "unresolved stays": "VERID_BURNT_GIT_UNRESOLVED",
    });
  });
});

describe("gitCalls and decideGit: forms that hide or move main", () => {
  it("finds Git behind escaped or ANSI-C quoted names and escaped characters in substitutions", () => {
    const rows = [
      "\\git commit -m x",
      "g\\it commit -m x",
      "$'git' commit -m x",
      "echo $'a\\'b'; git commit -m x",
      "echo $(echo \\(); git commit -m x; echo \\)",
      "x=$(echo it\\'s); git commit -m y",
    ];
    expect(Object.fromEntries(rows.map((r) => [r, calls(r)]))).toEqual({
      "\\git commit -m x": ["|commit -m x|dynamic command|"],
      "g\\it commit -m x": ["|commit -m x|dynamic command|"],
      "$'git' commit -m x": ["|commit -m x|dynamic command|"],
      "echo $'a\\'b'; git commit -m x": ["|commit -m x||"],
      "echo $(echo \\(); git commit -m x; echo \\)": ["|commit -m x||;"],
      "x=$(echo it\\'s); git commit -m y": ["|commit -m y||"],
    });
  });

  it("reads a Codex shell line the PowerShell way too", () => {
    const rows = [
      'echo "C:\\x\\"; git commit -m "feat: y"',
      "echo `a; git commit -m x; echo `b",
      "git -C C:\\repo commit -m x",
      'git commit -m @"\nline; git push\n"@',
    ];
    expect(
      Object.fromEntries(
        rows.map((r) => [
          r,
          gitCalls(r, "powershell").map(
            (c) =>
              `${c.dirs.join(">")}|${c.args.map((w) => w.text).join(" ")}|${c.unresolved ?? ""}`,
          ),
        ]),
      ),
    ).toEqual({
      'echo "C:\\x\\"; git commit -m "feat: y"': ["|commit -m feat: y|"],
      "echo `a; git commit -m x; echo `b": ["|commit -m x|"],
      "git -C C:\\repo commit -m x": ["C:\\repo|commit -m x|"],
      'git commit -m @"\nline; git push\n"@': ["|commit -m line; git push|"],
    });
  });

  it("refuses subcommands it does not model, and ref writes hidden by options, case or main's identity", () => {
    const updating = repo({ config: { "rebase.updaterefs": ["true"] } });
    expect(
      judged([
        ["git replay --advance main main..feat/a", repo()],
        ["git town ship", repo()],
        ["git receive-pack .", repo()],
        ["git branch -v -f main HEAD~1", repo()],
        ["git branch -vf main HEAD~1", repo()],
        ["git branch --sort=refname -f main HEAD~1", repo()],
        ["git checkout main -- && git commit -m x", repo()],
        ["git checkout main -- a.ts && git commit -m x", repo()],
        ["git update-ref refs/heads/MAIN HEAD~2", repo()],
        ["git commit -m x", repo({ branch: "MAIN" })],
        ["git fetch . feat/a:refs/heads/MAIN", repo()],
        ["git push origin HEAD:refs/heads/Main", repo()],
        ["git push origin HEAD:heads/main", repo()],
        ["git rebase --update-refs --onto main~1 main~3", repo()],
        ["git rebase main", updating, "rebase.updateRefs set"],
        ["git rebase --no-update-refs main", updating, "rebase.updateRefs, refused by option"],
        ["git remote set-head origin feat/a", repo()],
        ["git remote rename origin up", repo()],
        ["git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/feat/a", repo()],
        ["git symbolic-ref refs/heads/main refs/heads/feat/a", repo()],
        ["git update-ref --no-deref refs/remotes/origin/HEAD abc", repo()],
        ["git push --recurse-submodules on-demand origin feat/a", repo()],
      ]),
    ).toEqual({
      "feat/a: git replay --advance main main..feat/a": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git town ship": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git receive-pack .": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git branch -v -f main HEAD~1": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git branch -vf main HEAD~1": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git branch --sort=refname -f main HEAD~1": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git checkout main -- && git commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git checkout main -- a.ts && git commit -m x": "allow",
      "feat/a: git update-ref refs/heads/MAIN HEAD~2": "VERID_BURNT_GIT_MAIN_COMMIT",
      "MAIN: git commit -m x": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git fetch . feat/a:refs/heads/MAIN": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git push origin HEAD:refs/heads/Main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git push origin HEAD:heads/main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git rebase --update-refs --onto main~1 main~3": "VERID_BURNT_GIT_UNRESOLVED",
      "rebase.updateRefs set": "VERID_BURNT_GIT_UNRESOLVED",
      "rebase.updateRefs, refused by option": "allow",
      "feat/a: git remote set-head origin feat/a": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git remote rename origin up": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/feat/a":
        "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git symbolic-ref refs/heads/main refs/heads/feat/a": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git update-ref --no-deref refs/remotes/origin/HEAD abc":
        "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git push --recurse-submodules on-demand origin feat/a": "VERID_BURNT_GIT_UNRESOLVED",
    });
  });
});

describe("decideGit: options Git abbreviates or reads from config", () => {
  it("refuses option abbreviations, interactive rebases and writes through symbolic refs or worktree HEADs", () => {
    const interactive = repo({ config: { "branch.feat/a.rebase": ["interactive"] } });
    const recursing = repo({ config: { "push.recursesubmodules": ["on-demand"] } });
    expect(
      judged([
        ["git symbolic-ref -m x HEAD refs/heads/main && git commit -m x", repo()],
        ["git symbolic-ref refs/heads/feat/x refs/heads/main", repo()],
        ["git symbolic-ref --del refs/remotes/origin/HEAD", repo()],
        ["git symbolic-ref HEAD", repo()],
        ["git update-ref main-worktree/HEAD HEAD~1", repo()],
        ["git update-ref worktrees/w/HEAD HEAD~1", repo()],
        ["git rebase --upd --onto main~1 main~3", repo()],
        ['git rebase "--ex=cmd" main', repo()],
        ["git rebase -i main", repo()],
        ["git config rebase.updateRefs true; git rebase main", repo()],
        ["git pull --rebase=interactive", repo()],
        ["git pull --frobnicate", repo()],
        ["git pull", interactive, "branch rebase interactive"],
        ["git rebase --onto main~1 main~3", repo()],
        ["git pull --rebase origin main", repo()],
        ["git branch -d -r origin/HEAD", repo()],
        ["git remote set-url origin ../own", repo()],
        ["git fetch origin +refs/heads/x:refs/remotes/origin/HEAD", repo()],
        ["git push origin feat/a", recursing, "push.recurseSubmodules"],
      ]),
    ).toEqual({
      "feat/a: git symbolic-ref -m x HEAD refs/heads/main && git commit -m x":
        "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git symbolic-ref refs/heads/feat/x refs/heads/main": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git symbolic-ref --del refs/remotes/origin/HEAD": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git symbolic-ref HEAD": "allow",
      "feat/a: git update-ref main-worktree/HEAD HEAD~1": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git update-ref worktrees/w/HEAD HEAD~1": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git rebase --upd --onto main~1 main~3": "VERID_BURNT_GIT_UNRESOLVED",
      'feat/a: git rebase "--ex=cmd" main': "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git rebase -i main": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git config rebase.updateRefs true; git rebase main": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git pull --rebase=interactive": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git pull --frobnicate": "VERID_BURNT_GIT_UNRESOLVED",
      "branch rebase interactive": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git rebase --onto main~1 main~3": "allow",
      "feat/a: git pull --rebase origin main": "allow",
      "feat/a: git branch -d -r origin/HEAD": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git remote set-url origin ../own": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git fetch origin +refs/heads/x:refs/remotes/origin/HEAD":
        "VERID_BURNT_GIT_UNRESOLVED",
      "push.recurseSubmodules": "VERID_BURNT_GIT_UNRESOLVED",
    });
  });

  it("finds Git spelled with ANSI-C escapes, and PowerShell's typographic quotes", () => {
    expect({
      hex: calls("$'\\x67it' commit -m x"),
      octal: calls("$'\\147it' commit -m x"),
      typographic: gitCalls('echo "x\u201C; git commit -m y; echo \u201D"', "powershell").map((c) =>
        c.args.map((w) => w.text).join(" "),
      ),
    }).toEqual({
      hex: ["|commit -m x|dynamic command|"],
      octal: ["|commit -m x|dynamic command|"],
      typographic: ["commit -m y"],
    });
  });
});

describe("decideGit: option values, repeated options and configuration", () => {
  it("reads option values as values, refuses repeats and config writes, and follows upstream pushes", () => {
    const upstream = repo({
      config: { "branch.feat/c.merge": ["refs/heads/main"], "branch.feat/c.remote": ["origin"] },
      heads: ["main", "feat/a", "feat/c"],
    });
    expect(
      judged([
        ["git merge -m --abort feat/b", ON_MAIN],
        ["git am --exclude --abort x.patch", ON_MAIN],
        ["git rebase -X --abort feat/b main", repo()],
        ["git merge --abort", ON_MAIN],
        ["git checkout --conflict merge main && git commit -m x", repo()],
        ["git rebase --empty drop feat/b main", repo()],
        ["git pull --cleanup strip origin main:main", repo()],
        ["git checkout -B feat/x -B main", repo()],
        ["git switch -C feat/x --force-create main", repo()],
        ["git fetch . +feat/b:heads/main", repo()],
        ["A=$B git commit -m x", repo()],
        ['GIT_DIR="$D" git commit -m x', repo()],
        ["HOME=/tmp/h git push origin feat/a", repo()],
        ["XDG_CONFIG_HOME=/tmp/x git commit -m x", repo()],
        ["git push origin feat/c", upstream, "src-only push with an upstream on main"],
        ["git rebase --edit-todo", repo()],
        ["git config core.fsmonitor ./x", repo()],
        ["git config --get user.email", repo()],
        ["git config user.email", repo()],
      ]),
    ).toEqual({
      "main: git merge -m --abort feat/b": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git am --exclude --abort x.patch": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git rebase -X --abort feat/b main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "main: git merge --abort": "allow",
      "feat/a: git checkout --conflict merge main && git commit -m x":
        "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git rebase --empty drop feat/b main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git pull --cleanup strip origin main:main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: git checkout -B feat/x -B main": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git switch -C feat/x --force-create main": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git fetch . +feat/b:heads/main": "VERID_BURNT_GIT_MAIN_COMMIT",
      "feat/a: A=$B git commit -m x": "VERID_BURNT_GIT_UNRESOLVED",
      'feat/a: GIT_DIR="$D" git commit -m x': "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: HOME=/tmp/h git push origin feat/a": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: XDG_CONFIG_HOME=/tmp/x git commit -m x": "VERID_BURNT_GIT_UNRESOLVED",
      "src-only push with an upstream on main": "VERID_BURNT_GIT_PROTECTED_PUSH",
      "feat/a: git rebase --edit-todo": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git config core.fsmonitor ./x": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git config --get user.email": "allow",
      "feat/a: git config user.email": "allow",
    });
  });
});

describe("decideGit: computed arguments, Git's own file writers and editors", () => {
  it("refuses computed arguments, file-writing options, editor variables and config removal", () => {
    expect(
      judged([
        ['set -- -B main; git checkout "$@"', repo()],
        ['git switch "$@"', repo()],
        ["git rebase $X", repo()],
        ['git config "$@"', repo()],
        ['git worktree "$@"', repo()],
        ['git stash "$@"', repo()],
        ['git commit -m "$msg"', repo()],
        ["git config core.fsmonitor 'list=1; x'", repo()],
        ["git config --unset core.editor", repo()],
        ["git config get user.email", repo()],
        ["git log -1 --output=.git/refs/heads/main feat/b", repo()],
        ["git diff --output x.txt", repo()],
        ["git merge-file a b c", repo()],
        ["git checkout-index -f --prefix=x/ main", repo()],
        ["git init --template=tpl", repo()],
        ["EDITOR='x' git commit -e -m y", repo()],
        ["VISUAL=x git commit -e -m y", repo()],
        ["git log -1", repo()],
      ]),
    ).toEqual({
      'feat/a: set -- -B main; git checkout "$@"': "VERID_BURNT_GIT_UNRESOLVED",
      'feat/a: git switch "$@"': "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git rebase $X": "VERID_BURNT_GIT_UNRESOLVED",
      'feat/a: git config "$@"': "VERID_BURNT_GIT_UNRESOLVED",
      'feat/a: git worktree "$@"': "VERID_BURNT_GIT_UNRESOLVED",
      'feat/a: git stash "$@"': "VERID_BURNT_GIT_UNRESOLVED",
      'feat/a: git commit -m "$msg"': "allow",
      "feat/a: git config core.fsmonitor 'list=1; x'": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git config --unset core.editor": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git config get user.email": "allow",
      "feat/a: git log -1 --output=.git/refs/heads/main feat/b": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git diff --output x.txt": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git merge-file a b c": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git checkout-index -f --prefix=x/ main": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git init --template=tpl": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: EDITOR='x' git commit -e -m y": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: VISUAL=x git commit -e -m y": "VERID_BURNT_GIT_UNRESOLVED",
      "feat/a: git log -1": "allow",
    });
  });

  it("treats PowerShell splatting as computed", () => {
    expect(
      gitCalls("git checkout @a", "powershell").map((c) => c.args.map((w) => w.dynamic)),
    ).toEqual([[false, true]]);
  });
});

describe("resolveMain: which branch is main in one Git root", () => {
  it("takes a repo's declaration, then the root's, then origin/HEAD, then the sole main or master", () => {
    const none = { declared: [], originHead: null, heads: [] };
    expect({
      "repo declares trunk": resolveMain({ ...none, declared: ["trunk"], rootDefault: "main" }),
      "two repos agree": resolveMain({ ...none, declared: ["trunk", "trunk"] }),
      "root declares": resolveMain({ ...none, rootDefault: "develop", originHead: "main" }),
      "origin/HEAD": resolveMain({ ...none, originHead: "main", heads: ["master"] }),
      "sole main": resolveMain({ ...none, heads: ["main", "feat/a"] }),
      "sole master": resolveMain({ ...none, heads: ["master"] }),
      "repos disagree": resolveMain({ ...none, declared: ["main", "trunk"] }),
      "main and master": resolveMain({ ...none, heads: ["main", "master"] }),
      "no main yet": resolveMain({ ...none, heads: ["feat/a"] }),
    }).toEqual({
      "repo declares trunk": { ok: true, main: "trunk" },
      "two repos agree": { ok: true, main: "trunk" },
      "root declares": { ok: true, main: "develop" },
      "origin/HEAD": { ok: true, main: "main" },
      "sole main": { ok: true, main: "main" },
      "sole master": { ok: true, main: "master" },
      "repos disagree": { ok: false, detail: "conflicting default_branch: main, trunk" },
      "main and master": { ok: false, detail: "both main and master exist" },
      "no main yet": { ok: false, detail: "no main branch" },
    });
  });
});

describe("closeHistory: the Git evidence a module needs to close", () => {
  it("checks every message since the recorded base and only counts extra commits", () => {
    const good = { sha: "a".repeat(40), message: "feat: add signup\n" };
    const repair = { sha: "b".repeat(40), message: "fix(api): reject empty name\n\nWhy.\n" };
    const bad = { sha: "c".repeat(40), message: "wip\n" };
    expect({
      "one commit": closeHistory([{ repo: "api", ancestor: true, commits: [good] }]),
      "no commit yet": closeHistory([{ repo: ".", ancestor: true, commits: [] }]),
      "two commits": closeHistory([
        { repo: "api", ancestor: true, commits: [repair, good] },
        { repo: "web", ancestor: true, commits: [good] },
      ]),
      "older bad message": closeHistory([{ repo: "api", ancestor: true, commits: [good, bad] }]),
      "base not an ancestor": closeHistory([{ repo: "api", ancestor: false, commits: [good] }]),
      unreadable: closeHistory([{ repo: "web", error: "git is gone" }]),
    }).toEqual({
      "one commit": { problem: null, counts: [] },
      "no commit yet": { problem: null, counts: [] },
      "two commits": { problem: null, counts: [{ repo: "api", commits: 2 }] },
      "older bad message": {
        problem: {
          code: "VERID_BURNT_GIT_COMMIT_MESSAGE",
          params: { repo: "api", commit: "cccccccccccc", header: "wip" },
        },
        counts: [{ repo: "api", commits: 2 }],
      },
      "base not an ancestor": {
        problem: {
          code: "VERID_BURNT_GIT_WORK_BASE",
          params: { repo: "api", detail: "HEAD does not descend from the recorded main commit" },
        },
        counts: [],
      },
      unreadable: {
        problem: {
          code: "VERID_BURNT_GIT_WORK_BASE",
          params: { repo: "web", detail: "git is gone" },
        },
        counts: [],
      },
    });
  });
});
