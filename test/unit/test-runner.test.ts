import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IGNORE_GLOBS, TEST_GLOBS } from "../../src/core/manifest.js";
import { detectRunners } from "../../src/core/runners.js";
import { clearReports, findRunners, reportFolders } from "../../src/adapters/test-runner.js";

const layout = { sourceGlobs: ["**"], testGlobs: TEST_GLOBS, ignoreGlobs: IGNORE_GLOBS };
let root: string;
const write = (rel: string, text = "") => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verid-runners-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("findRunners", () => {
  it("reads the build files of the repo root and of its top-level folders that hold code", () => {
    write("pyproject.toml", "[tool.pytest.ini_options]\n");
    write("fe/package.json", '{"devDependencies":{"vitest":"^3"}}');
    write("api/go.mod", "module x\n");
    write("node_modules/lib/package.json", '{"devDependencies":{"jest":"^29"}}');
    write(".tools/pom.xml", "<project/>");
    write("native/Cargo.toml", "");
    write("broken/package.json", "{ not json");
    const { runners, unsupported } = findRunners(root, layout);
    expect({ runners: runners.map((r) => `${r.name}@${r.dir}`), unsupported }).toEqual({
      runners: ["pytest@.", "go@api", "vitest@fe"],
      unsupported: ["native/Cargo.toml"],
    });
  });
});

describe("reportFolders and clearReports", () => {
  it("finds the report folders of Maven modules that exist and removes only their old TEST-*.xml", () => {
    write("pom.xml", "<project/>");
    write("target/surefire-reports/TEST-a.ATest.xml", "<testsuite/>");
    write("target/surefire-reports/a.ATest.txt", "log");
    write("core/target/surefire-reports/TEST-b.BTest.xml", "<testsuite/>");
    write("web/index.html", "");
    const [maven] = detectRunners(
      [{ dir: ".", files: ["pom.xml"], deps: [], texts: {} }],
      true,
    ).runners;
    if (!maven) throw new Error("no maven runner");
    const folders = reportFolders(root, maven);
    const rel = (paths: string[]) => paths.map((p) => relative(root, p).replaceAll("\\", "/"));
    // Only those that exist: called again after the run, which creates them.
    expect(rel(folders)).toEqual(["target/surefire-reports", "core/target/surefire-reports"]);
    clearReports(folders);
    expect({
      root: existsSync(join(root, "target/surefire-reports/TEST-a.ATest.xml")),
      log: existsSync(join(root, "target/surefire-reports/a.ATest.txt")),
      module: existsSync(join(root, "core/target/surefire-reports/TEST-b.BTest.xml")),
    }).toEqual({ root: false, log: true, module: false });
  });
});
