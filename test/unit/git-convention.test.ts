import { describe, expect, it } from "vitest";
import {
  isConventionalCommit,
  isWorkBranch,
  resolveMain,
  closeHistory,
} from "../../src/core/git-convention.js";
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
