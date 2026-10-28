import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeRoots, gitCallFacts, gitView, squashOn } from "../../src/adapters/git.js";
import { decideGit, gitCalls } from "../../src/core/git-convention.js";

const GIT_ENV = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "XDG_CONFIG_HOME"] as const;
let saved: Record<string, string | undefined>;
let dirs: string[];

// A name with a space and `$$`, as a project folder may have.
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "verid git $$-"));
  dirs.push(dir);
  return dir;
};
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};
const write = (root: string, rel: string, text = "x") => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const repo = (): string => {
  const dir = tmp();
  git(dir, "init", "-q");
  return dir;
};
const committed = (): string => {
  const dir = repo();
  write(dir, "src/a.ts");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
};

beforeEach(() => {
  dirs = [];
  saved = Object.fromEntries(GIT_ENV.map((k) => [k, process.env[k]]));
  // No global or system config, and no default global ignore file: the machine's own ignore
  // rules must not decide what the test asserts.
  const empty = tmp();
  writeFileSync(join(empty, "config"), "");
  process.env.GIT_CONFIG_GLOBAL = join(empty, "config");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.XDG_CONFIG_HOME = empty;
});
afterEach(() => {
  for (const k of GIT_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("gitView", () => {
  it("reads whether the project's tree is clean, outside git null", () => {
    const plain = tmp();
    const fresh = repo();
    const withUntrackedSrc = repo();
    write(withUntrackedSrc, "src/a.ts");
    const settingsOnly = committed();
    write(settingsOnly, ".claude/settings.local.json", "{}");
    const codexHooksOnly = committed();
    write(codexHooksOnly, ".codex/hooks.json", "{}");
    const otherCodexFile = committed();
    write(otherCodexFile, ".codex/config.toml", "");
    const parent = repo();
    write(parent, "app/src/a.ts");
    git(parent, "add", "-A");
    git(parent, "commit", "-q", "-m", "init");
    write(parent, "other/x.txt");
    const cleanCommitted = committed();
    const hidingUntracked = committed();
    git(hidingUntracked, "config", "status.showUntrackedFiles", "no");
    write(hidingUntracked, "src/new.ts");

    expect({
      "not a repo": gitView(plain),
      "no commit yet": gitView(fresh),
      untracked: gitView(withUntrackedSrc)?.clean,
      committed: gitView(cleanCommitted)?.clean,
      head: /^[0-9a-f]{40}$/.test(gitView(cleanCommitted)?.head ?? ""),
      "machine settings": gitView(settingsOnly)?.clean,
      "Codex machine hooks": gitView(codexHooksOnly)?.clean,
      "other Codex file": gitView(otherCodexFile)?.clean,
      "sibling folder dirty": gitView(join(parent, "app"))?.clean,
      "config hides untracked": gitView(hidingUntracked)?.clean,
    }).toEqual({
      "not a repo": null,
      "no commit yet": { clean: true, head: null },
      untracked: false,
      committed: true,
      head: true,
      "machine settings": true,
      "Codex machine hooks": true,
      "other Codex file": false,
      "sibling folder dirty": true,
      "config hides untracked": false,
    });
  });

  it("gives up on Git once the hook's time budget is spent, which refuses the call", () => {
    const dir = committed();
    const calls = gitCalls("git commit -m x");
    const manifest = { repos: [], layout: "monorepo" as const };
    const judge = (deadline: number) => {
      const facts = gitCallFacts(calls, dir, dir, manifest, deadline);
      const denied = decideGit(calls, facts, { protectedRefs: [] }, new Set());
      return denied.map((d) => (d.kind === "deny" ? d.code : d.kind)).join() || "allow";
    };
    expect({
      "within budget": judge(Date.now() + 10_000),
      "budget spent": judge(Date.now() - 1),
    }).toEqual({
      "within budget": "VERID_BURNT_GIT_MAIN_COMMIT",
      "budget spent": "VERID_BURNT_GIT_UNRESOLVED",
    });
  });

  it("refuses a Git call when a manifest repo's default_branch cannot be read", () => {
    const dir = committed();
    git(dir, "switch", "-q", "-c", "feat/a");
    const broken = repo();
    writeFileSync(join(broken, ".git", "config"), "[core\nbroken");
    const calls = gitCalls("git commit -m x");
    const judge = (
      repos: {
        path: string;
        default_branch: string;
        source_globs: string[];
        test_globs: string[];
      }[],
    ) => {
      const facts = gitCallFacts(calls, dir, dir, { repos });
      const denied = decideGit(calls, facts, { protectedRefs: [] }, new Set());
      return denied.map((d) => (d.kind === "deny" ? d.code : d.kind)).join() || "allow";
    };
    const declared = { default_branch: "master", source_globs: ["**"], test_globs: ["t/**"] };
    expect({
      readable: judge([{ path: ".", ...declared }]),
      unreadable: judge([
        { path: ".", ...declared },
        { path: relative(dir, broken), ...declared },
      ]),
    }).toEqual({ readable: "allow", unreadable: "VERID_BURNT_GIT_UNRESOLVED" });
  });

  it("counts a repo git fails to read as not clean", () => {
    const brokenConfig = committed();
    writeFileSync(join(brokenConfig, ".git", "config"), "[core\nnot a config line");
    expect({ "broken config": gitView(brokenConfig) }).toEqual({
      "broken config": { clean: false, head: null },
    });
  });
});

describe("squashOn: a closed module's squash on the local main", () => {
  it("finds only the exact change in one single-parent Conventional commit, and keeps waiting otherwise", () => {
    const out = (cwd: string, ...args: string[]) =>
      spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();
    // A module closed on feat/a from main: a text file, a binary file, an executable bit, a rename
    // and a deletion. `integrate` then does what the developer did on main.
    const closed = (integrate: (dir: string) => void, deadline = Infinity) => {
      const dir = tmp();
      git(dir, "init", "-q", "-b", "main");
      write(dir, "old.txt", "old");
      write(dir, "gone.txt", "gone");
      write(dir, "run.sh", "echo");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "chore: start");
      const base = out(dir, "rev-parse", "HEAD");
      git(dir, "switch", "-q", "-c", "feat/a");
      write(dir, "src/a.ts", "export const a = 1;\n");
      writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 255, 0]));
      git(dir, "update-index", "--chmod=+x", "run.sh");
      git(dir, "mv", "old.txt", "new.txt");
      git(dir, "rm", "-q", "gone.txt");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "feat: a");
      const roots = closeRoots(dir, { ".": { main: "main", base } });
      if ("detail" in roots) throw new Error(String(roots.detail));
      git(dir, "switch", "-q", "main");
      integrate(dir);
      const found = squashOn(dir, ".", roots["."]!, deadline);
      return "error" in found
        ? `unclear: ${found.error}`
        : found.sha === null
          ? "waiting"
          : found.sha === out(dir, "log", "-1", "--format=%H", "--grep=^feat: a (#1)$", "main")
            ? "integrated"
            : `other ${found.sha}`;
    };
    const squash = (dir: string, message = "feat: a (#1)") => {
      git(dir, "merge", "--squash", "-q", "feat/a");
      git(dir, "commit", "-q", "-m", message);
    };
    const unrelated = (dir: string, name: string) => {
      write(dir, name, name);
      git(dir, "add", name);
      git(dir, "commit", "-q", "-m", `docs: ${name}`);
    };
    // Many commits on main at once, without a Git run each.
    const commits = (dir: string, n: number) => {
      const stream = Array.from({ length: n }, (_, i) => {
        const message = `chore: step ${i}`;
        const from = i === 0 ? "from refs/heads/main^0\n" : "";
        return `commit refs/heads/main\ncommitter t <t@t> ${1700000000 + i} +0000\ndata ${message.length}\n${message}\n${from}\n`;
      }).join("");
      const r = spawnSync("git", ["fast-import", "--quiet"], { cwd: dir, input: stream });
      if (r.status !== 0) throw new Error(String(r.stderr));
      git(dir, "reset", "-q", "--hard", "main");
    };
    expect({
      "not merged yet": closed(() => {}),
      "squash among unrelated commits": closed((dir) => {
        unrelated(dir, "before.md");
        squash(dir);
        unrelated(dir, "after.md");
      }),
      "squash, then the branch deleted": closed((dir) => {
        squash(dir);
        git(dir, "branch", "-q", "-D", "feat/a");
      }),
      "split in two commits": closed((dir) => {
        git(dir, "checkout", "-q", "feat/a", "--", "src/a.ts");
        git(dir, "commit", "-q", "-m", "feat: a part 1");
        squash(dir, "feat: a part 2");
      }),
      "merge commit": closed((dir) =>
        git(dir, "merge", "-q", "--no-ff", "-m", "feat: a (#1)", "feat/a"),
      ),
      "message only": closed((dir) => unrelated(dir, "feat-a.md")),
      "rewritten main": closed((dir) => {
        git(dir, "switch", "-q", "--orphan", "fresh");
        unrelated(dir, "fresh.md");
        git(dir, "branch", "-q", "-f", "main", "fresh");
        git(dir, "switch", "-q", "main");
      }),
      "more than 200 commits": closed((dir) => {
        squash(dir);
        commits(dir, 201);
      }),
      "time ran out": closed((dir) => squash(dir), Date.now() - 1),
      "a replace ref posing as the squash": closed((dir) => {
        unrelated(dir, "other.md");
        const tree = out(dir, "rev-parse", "feat/a^{tree}");
        const base = out(dir, "rev-parse", "main~1");
        const fake = spawnSync(
          "git",
          [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit-tree",
            tree,
            "-p",
            base,
            "-m",
            "feat: a (#1)",
          ],
          { cwd: dir, encoding: "utf8" },
        ).stdout.trim();
        git(dir, "replace", out(dir, "rev-parse", "main"), fake);
      }),
    }).toEqual({
      "not merged yet": "waiting",
      "squash among unrelated commits": "integrated",
      "squash, then the branch deleted": "integrated",
      "split in two commits": "waiting",
      "merge commit": "waiting",
      "message only": "waiting",
      "rewritten main": "unclear: main no longer holds the commit the module started from",
      "more than 200 commits": "unclear: more than 200 commits on main since the module started",
      "a replace ref posing as the squash": "waiting",
      "time ran out":
        "unclear: main main cannot be read: git did not run: verid's time for Git ran out",
    });
  }, 60_000); // many Git runs: slow on a busy machine
});
