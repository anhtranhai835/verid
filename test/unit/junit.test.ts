import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJUnit } from "../../src/adapters/junit.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "junit");
const read = (name: string) => readJUnit(join(FIXTURES, name));
const firstLines = (name: string) =>
  read(name)?.map((c) => ({ ...c, message: c.message.split("\n")[0] }));

describe("readJUnit", () => {
  it("reads a recorded vitest RED run: load error, assertion failure, skip, pass", () => {
    expect(firstLines("vitest-red.xml")).toEqual([
      {
        id: "test/add.test.ts",
        status: "failed",
        message:
          "Error: Cannot find module '../src/add.js' imported from /project/test/add.test.ts",
      },
      {
        id: "test/greet.test.ts > greet & <name> > says hi",
        status: "failed",
        message: "AssertionError: expected 'Hello An' to be 'Hi An' // Object.is equality",
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

  it("reads a recorded vitest GREEN run", () => {
    expect(read("vitest-green.xml")?.map((c) => [c.id, c.status])).toEqual([
      ["test/add.test.ts > adds two numbers", "passed"],
      ["test/greet.test.ts > greet & <name> > says hi", "passed"],
      ["test/greet.test.ts > greet & <name> > speaks Vietnamese", "skipped"],
      ["test/greet.test.ts > greet & <name> > returns a string", "passed"],
    ]);
  });

  it("reads a root <testsuite>, nested suites, <error> and message-only failures", () => {
    expect(read("synthetic-pytest-shapes.xml")).toEqual([
      { id: "tests.test_calc > test_add", status: "passed", message: "" },
      {
        id: "tests.test_io",
        status: "failed",
        message: "ImportError: No module named 'io_utils'",
      },
      { id: "tests.test_more > test_bad", status: "failed", message: "assert 1 == 2" },
      { id: "tests.test_more > test_later", status: "skipped", message: "" },
    ]);
  });

  it.each([
    ["a missing file", null],
    ["a truncated report", '<testsuites><testsuite name="x"><testcase name="a">'],
    ["not XML at all", "PASS 3 tests"],
  ])("returns null for %s", (_name, content) => {
    const dir = mkdtempSync(join(tmpdir(), "verid-junit-"));
    try {
      const file = join(dir, "junit.xml");
      if (content !== null) writeFileSync(file, content);
      expect(readJUnit(file)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns no cases for a report without tests", () => {
    const dir = mkdtempSync(join(tmpdir(), "verid-junit-"));
    try {
      const file = join(dir, "junit.xml");
      writeFileSync(file, '<?xml version="1.0"?><testsuites name="vitest tests" tests="0"/>');
      expect(readJUnit(file)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
