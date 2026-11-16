import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileAction } from "../../src/adapters/claude-code.js";
import { legacyPolicy, legacyShellWrite } from "../../src/adapters/legacy-policy.js";
import { isOverridable, RULE_CODES } from "../../src/core/errors.js";
import { parseManifest } from "../../src/core/manifest.js";
import { decide, type PolicyContext } from "../../src/core/policy.js";

const repo = (path: string, extra: object = {}) => ({
  path,
  source_globs: ["**"],
  test_globs: ["**/*.test.*"],
  ...extra,
});
const manifestOf = (mode: string, repos: object[]) => {
  const parsed = parseManifest({ schemaVersion: 1, mode, repos });
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.manifest;
};

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "verid-legacy-policy-")));
  mkdirSync(join(root, "legacy"));
  mkdirSync(join(root, "app"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const reheat = () =>
  manifestOf("reheat", [repo("app"), repo("legacy", { role: "legacy", read_only: true })]);
const context = (cwd = root): PolicyContext => ({
  stateDir: join(root, ".verid", ".state"),
  manifestPath: join(root, ".verid", "manifest.yaml"),
  transcriptsDir: join(root, "transcripts"),
  distDir: join(root, "dist"),
  planPath: join(root, ".verid", "plan.md"),
  researchMissing: false,
  specMissing: false,
  designMissing: false,
  ...legacyPolicy(root, reheat(), cwd),
});
const roots = () => context().legacy!.roots;

describe("legacy file rule", () => {
  const write = (rel: string, tool = "Write") =>
    fileAction(tool, "write", join(root, ...rel.split("/")), root);
  const everyRule = new Set(RULE_CODES);

  it("refuses every write into the legacy repo, whichever rule the developer lifted", () => {
    for (const rel of ["legacy/a.txt", "legacy/deep/er/b.json", "legacy"])
      for (const tool of ["Write", "Edit", "apply_patch", "mcp__files__write_file"]) {
        const refused = decide(write(rel, tool), context(), everyRule);
        expect(refused, `${tool} ${rel}`).toMatchObject({
          kind: "deny",
          code: "VERID_BURNT_LEGACY_READ_ONLY",
        });
      }
    expect(isOverridable("VERID_BURNT_LEGACY_READ_ONLY")).toBe(false);
  });

  it("allows reading the legacy repo and writing the new one", () => {
    expect(
      decide(fileAction("Read", "read", join(root, "legacy", "a.txt"), root), context()),
    ).toMatchObject({ kind: "allow" });
    expect(decide(write("app/src/a.ts"), context())).toMatchObject({ kind: "allow" });
    expect(decide(write("legacy-notes.txt"), context())).toMatchObject({ kind: "allow" });
  });

  it("does nothing outside mode reheat", () => {
    const prep = manifestOf("prep", [repo("app"), repo("legacy")]);
    expect(legacyPolicy(root, prep, root)).toEqual({});
    expect(legacyPolicy(root, null, root)).toEqual({});
    const plain = { ...context(), ...legacyPolicy(root, prep, root) };
    delete plain.legacy;
    expect(decide(write("legacy/a.txt"), plain)).toMatchObject({ kind: "allow" });
  });

  it("refuses a Git write or a shell write into legacy as a bash action, past any override", () => {
    for (const command of [
      'git -C legacy commit -m "x"',
      "cd legacy && git add .",
      "echo x > legacy/a.txt",
    ])
      expect(decide({ kind: "bash", command }, context(), everyRule), command).toMatchObject({
        kind: "deny",
        code: "VERID_BURNT_LEGACY_READ_ONLY",
      });
    expect(decide({ kind: "bash", command: "git -C legacy status" }, context())).toMatchObject({
      kind: "allow",
    });
  });
});

describe("legacy shell writes", () => {
  const blocked = [
    "echo bad > legacy/a.txt",
    "echo bad >> legacy/a.txt",
    "printf x | tee legacy/a.txt",
    "sed -i s/a/b/ legacy/a.txt",
    "touch legacy/new.txt",
    "truncate -s 0 legacy/a.txt",
    "rm legacy/a.txt",
    "rm -rf legacy",
    "rm -rf .",
    "rmdir legacy",
    "mv legacy legacy-old",
    "mv legacy/a.txt app/a.txt",
    "cp app/a.txt legacy/",
    "node -e \"require('fs').writeFileSync('legacy/a.txt','x')\"",
    'git -C legacy commit -m "x"',
    "git -C legacy add .",
    "git -C legacy checkout -- a.txt",
    "git -C legacy reset --hard",
    "git -Clegacy commit -m x",
    "git -c user.name=x -C legacy commit -m x",
    "git --git-dir=legacy/.git --work-tree=legacy commit -m x",
    "git --git-dir legacy/.git commit -m x",
    "git checkout -- legacy/a.txt",
    "git restore legacy",
    "cd legacy && git commit -m x",
    "cd legacy; git commit -m x",
    "cd legacy && echo x > b.txt",
    "cd legacy && rm a.txt",
    "cd app && cd ../legacy && git commit -m x",
    "env GIT_AUTHOR_NAME=x git -C legacy commit -m x",
    "sudo git -C legacy push",
    "true || git -C legacy commit -m x",
  ];
  const allowed = [
    "cat legacy/a.txt",
    "grep -r foo legacy",
    "ls legacy && cat legacy/a.txt",
    "git -C legacy status",
    "git -C legacy log --oneline",
    "git -C legacy diff HEAD",
    "cd legacy && ls && git status",
    "echo x > app/a.txt",
    "echo legacy > notes.txt",
    "cp legacy/a.txt app/",
    "mv app/a.txt app/b.txt",
    "rm app/a.txt",
    "git -C app commit -m x",
    "cd app && git commit -m x",
    "git status",
    "git commit -m x",
    "git commit -m legacy",
    "git add legacy",
  ];

  it.each(blocked)("blocks %s", (command) => {
    expect(legacyShellWrite(command, root, roots())).not.toBeNull();
  });

  it.each(allowed)("allows %s", (command) => {
    expect(legacyShellWrite(command, root, roots())).toBeNull();
  });

  it("follows a working directory inside the legacy repo", () => {
    const inside = join(root, "legacy");
    for (const command of ["git commit -m x", "git add .", "echo x > a.txt", "rm a.txt"])
      expect(legacyShellWrite(command, inside, roots()), command).not.toBeNull();
    for (const command of [
      "git status",
      "git log",
      "ls",
      "cat a.txt",
      "cd ../app && git commit -m x",
    ])
      expect(legacyShellWrite(command, inside, roots()), command).toBeNull();
  });
});
