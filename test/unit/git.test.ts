import { tempProject } from "../support/project.js";

import { writeFileSync } from "node:fs";

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitView } from "../../src/adapters/git.js";

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
