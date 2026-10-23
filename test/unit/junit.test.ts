import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readJUnit, readJUnitFiles, xmlReports } from "../../src/adapters/junit.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "junit");
const read = (name: string) => readJUnit(join(FIXTURES, name));
const firstLines = (name: string) =>
  read(name)?.map((c) => ({ ...c, message: c.message.split("\n")[0] }));

describe("readJUnit", () => {
  it("reads a recorded failing vitest run: load error, assertion failure, skip, pass", () => {
    expect(firstLines("vitest-red.xml")).toEqual([
      {
        id: "test/add.test.ts",
        status: "failed",
        message:
          "Error: Cannot find module '../src/add.js' imported from /project/test/add.test.ts",
        assertion: false,
      },
      {
        id: "test/greet.test.ts > greet & <name> > says hi",
        status: "failed",
        message: "AssertionError: expected 'Hello An' to be 'Hi An' // Object.is equality",
        assertion: true,
      },
      {
        id: "test/greet.test.ts > greet & <name> > speaks Vietnamese",
        status: "skipped",
        message: "",
      },
      {
        id: "test/greet.test.ts > greet & <name> > returns a string",
        status: "passed",
        message: "",
      },
    ]);
  });

  it("reads a root <testsuite>, nested suites, <error> and message-only failures", () => {
    expect(read("synthetic-pytest-shapes.xml")).toEqual([
      { id: "tests.test_calc > test_add", status: "passed", message: "" },
      {
        id: "tests.test_io",
        status: "failed",
        message: "ImportError: No module named 'io_utils'",
        assertion: false,
      },
      {
        id: "tests.test_more > test_bad",
        status: "failed",
        message: "assert 1 == 2",
        assertion: true,
      },
      // pytest writes the assertion in `message` and the source lines in the body.
      {
        id: "tests.test_more > test_body",
        status: "failed",
        message: "def test_body():\n>       assert add(1, 2) == 3",
        assertion: true,
      },
      { id: "tests.test_more > test_later", status: "skipped", message: "" },
    ]);
  });

  it("reads the reports of several runners as one run, in the order given", () => {
    expect({
      two: readJUnitFiles([
        join(FIXTURES, "vitest-green.xml"),
        join(FIXTURES, "pytest-assert.xml"),
      ])?.map((c) => c.id),
      none: readJUnitFiles([]),
      "one missing": readJUnitFiles([
        join(FIXTURES, "vitest-green.xml"),
        join(FIXTURES, "nope.xml"),
      ]),
    }).toEqual({
      two: [...(read("vitest-green.xml") ?? []), ...(read("pytest-assert.xml") ?? [])].map(
        (c) => c.id,
      ),
      none: null,
      "one missing": null,
    });
  });

  it("finds the XML reports in a folder and its subfolders, by name pattern", () => {
    const dir = mkdtempSync(join(tmpdir(), "verid-junit-"));
    try {
      mkdirSync(join(dir, "core", "target", "surefire-reports"), { recursive: true });
      mkdirSync(join(dir, "results", "guid"), { recursive: true });
      for (const f of [
        "core/target/surefire-reports/TEST-a.CalcTest.xml",
        "core/target/surefire-reports/a.CalcTest.txt",
        "results/App.Tests.xml",
        "results/guid/Other.Tests.xml",
      ])
        writeFileSync(join(dir, f), "<testsuites/>");
      const rel = (files: string[]) => files.map((f) => relative(dir, f).replaceAll("\\", "/"));
      expect({
        all: rel(xmlReports(join(dir, "results"))),
        maven: rel(xmlReports(join(dir, "core", "target", "surefire-reports"), /^TEST-.*\.xml$/)),
        missing: xmlReports(join(dir, "nope")),
      }).toEqual({
        all: ["results/App.Tests.xml", "results/guid/Other.Tests.xml"],
        maven: ["core/target/surefire-reports/TEST-a.CalcTest.xml"],
        missing: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a missing, truncated or non-XML report, and no cases for an empty one", () => {
    const dir = mkdtempSync(join(tmpdir(), "verid-junit-"));
    const report = (content: string | null) => {
      const file = join(dir, `${Math.random()}.xml`);
      if (content !== null) writeFileSync(file, content);
      return readJUnit(file);
    };
    try {
      expect({
        missing: report(null),
        truncated: report('<testsuites><testsuite name="x"><testcase name="a">'),
        "not XML": report("PASS 3 tests"),
        "no tests": report('<?xml version="1.0"?><testsuites name="vitest tests" tests="0"/>'),
      }).toEqual({ missing: null, truncated: null, "not XML": null, "no tests": [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
