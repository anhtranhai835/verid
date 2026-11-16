import { tempDirs, TEST_ROOT as root } from "../support/project.js";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const tempDir = tempDirs("verid-release-notes-");
const script = join(root, "scripts", "release-notes.mjs");

const changelog = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "- Not yet released.",
  "",
  "## [1.0.0] - 2026-11-16",
  "",
  "### Added",
  "",
  "- Something new.",
  "",
  "## [0.9.0] - 2026-11-10",
  "",
  "- Older entry.",
  "",
].join("\n");

/** The release workflow runs this script from the repository root with the pushed tag. */
function notes(version: string, tag: string[], text = changelog) {
  const dir = tempDir();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(dir, "CHANGELOG.md"), text);
  const r = spawnSync(process.execPath, [script, ...tag], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

it("prints only the CHANGELOG section of a tag that matches package.json", () => {
  const r = notes("1.0.0", ["v1.0.0"]);
  expect(r.code, r.err).toBe(0);
  expect(r.out).toBe("### Added\n\n- Something new.\n");
});

it("checks the current version when no tag is given, as a manual run does", () => {
  const r = notes("0.9.0", []);
  expect(r.code, r.err).toBe(0);
  expect(r.out).toBe("- Older entry.\n");
});

it("refuses a tag that differs from package.json or lacks the v prefix", () => {
  const cases = [{ tag: "v0.9.0" }, { tag: "1.0.0" }, { tag: "v1.0.0-rc.1" }];
  for (const { tag } of cases) {
    const r = notes("1.0.0", [tag]);
    expect(r.code, tag).toBe(1);
    expect(r.err, tag).toContain("v1.0.0");
    expect(r.out, tag).toBe("");
  }
});

it("refuses a version whose CHANGELOG section is missing or empty", () => {
  const cases = [
    { text: changelog.replace("## [1.0.0]", "## [1.0.1]") },
    { text: "## [1.0.0]\n\n## [0.9.0]\n" },
  ];
  for (const { text } of cases) {
    const r = notes("1.0.0", ["v1.0.0"], text);
    expect(r.code).toBe(1);
    expect(r.err).toContain("CHANGELOG.md");
    expect(r.out).toBe("");
  }
});
