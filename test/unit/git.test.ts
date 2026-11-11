import { tempProject } from "../support/project.js";

import { writeFileSync } from "node:fs";

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compactWorkLog, gitView } from "../../src/adapters/git.js";

const GIT_ENV = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "XDG_CONFIG_HOME"] as const;
let saved: Record<string, string | undefined>;

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

const t = tempProject("verid git $$-", {
  defaultText: "x",
  setup: () => {
    saved = Object.fromEntries(GIT_ENV.map((k) => [k, process.env[k]]));
    const empty = tmp();
    writeFileSync(join(empty, "config"), "");
    process.env.GIT_CONFIG_GLOBAL = join(empty, "config");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.XDG_CONFIG_HOME = empty;
  },
  teardown: () => {
    for (const k of GIT_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  },
});
const { newDir: tmp, gitAt: git, putAt: write } = t;

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

  it("counts a repo git fails to read as not clean", () => {
    const brokenConfig = committed();
    writeFileSync(join(brokenConfig, ".git", "config"), "[core\nnot a config line");
    expect({ "broken config": gitView(brokenConfig) }).toEqual({
      "broken config": { clean: false, head: null },
    });
  });
});

describe("compactWorkLog", () => {
  const baseOf = (dir: string) => git(dir, "rev-parse", "HEAD");
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  it("shows a file changed in several commits once, in one diff from the base", () => {
    const dir = committed();
    const base = baseOf(dir);
    for (const n of [1, 2, 3]) {
      write(dir, "src/a.ts", `line ${n}\n`);
      git(dir, "commit", "-q", "-am", `feat: step ${n}`);
    }
    const text = compactWorkLog(dir, { ".": { main: "main", base } }).join("\n");
    expect(count(text, "diff --git a/src/a.ts")).toBe(1);
    expect(text).toContain("feat: step 1");
    expect(text).toContain("feat: step 3");
    expect(text).toContain("history.md");
  });

  it("covers staged, unstaged, untracked, renamed and deleted files, each file once", () => {
    const dir = committed();
    write(dir, "src/keep.ts", "keep me\nkeep me too\nkeep me three\n");
    write(dir, "src/gone.ts", "bye\n");
    write(dir, "src/old-name.ts", "renamed body\nrenamed body two\nrenamed body three\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "chore: more files");
    const base = baseOf(dir);
    write(dir, "src/staged.ts", "staged new\n");
    git(dir, "add", "src/staged.ts");
    write(dir, "src/keep.ts", "keep me\nkeep me too\nkeep me three\nunstaged edit\n");
    write(dir, "src/untracked.ts", "untracked body\n");
    git(dir, "mv", "src/old-name.ts", "src/new-name.ts");
    git(dir, "rm", "-q", "src/gone.ts");
    const text = compactWorkLog(dir, { ".": { main: "main", base } }).join("\n");
    expect(text).toMatch(/files\s+5 changed, 2 new, 1 renamed, 1 deleted/);
    for (const name of ["staged.ts", "keep.ts", "untracked.ts", "new-name.ts", "gone.ts"])
      expect(text, name).toContain(`src/${name}`);
    expect(text).toContain("untracked body");
    expect(text).toContain("staged new");
    expect(text).toContain("unstaged edit");
    expect(count(text, "diff --git a/src/keep.ts")).toBe(1);
  });

  it("says which files were cut and where the full history is", () => {
    const dir = committed();
    const base = baseOf(dir);
    write(dir, "src/big-one.ts", "x".repeat(400) + "\n");
    write(dir, "src/big-two.ts", "y".repeat(400) + "\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "feat: big files");
    const text = compactWorkLog(dir, { ".": { main: "main", base } }, 600).join("\n");
    expect(text).toMatch(/cut.*history\.md/s);
    expect(text).toContain("big-two.ts");
    expect(text).not.toContain("y".repeat(400));
  });

  it("never shows secret files", () => {
    const dir = committed();
    const base = baseOf(dir);
    write(dir, ".env", "TOKEN=hunter2\n");
    write(dir, "config/db-credentials.json", "swordfish\n");
    write(dir, "src/key.pem", "-----BEGIN KEY-----\n");
    write(dir, "src/ok.ts", "fine\n");
    git(dir, "add", ".env");
    const text = compactWorkLog(dir, { ".": { main: "main", base } }).join("\n");
    expect(text).toContain("fine");
    for (const secret of ["hunter2", "swordfish", "BEGIN KEY"]) expect(text).not.toContain(secret);
  });
});
