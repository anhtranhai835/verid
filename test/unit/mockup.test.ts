import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { expect, it, vi } from "vitest";
import * as mockups from "../../src/adapters/mockups.js";
import { mockupCommand } from "../../src/cli/mockup.js";
import { tempProject, kanbanManifest, readyModulePlan } from "../support/project.js";
import { runCli } from "../e2e/in-process.js";
import { planViews, readPlan } from "../../src/adapters/plan-file.js";

const base = ".verid/artifacts/03-modules/screen/ui/mockups";
const p = tempProject("verid-mockup-cli-", {
  manifest: kanbanManifest,
  state: { schemaVersion: 1, language: "en" },
  setup: (p) => {
    p.put(".verid/research.md", "Agreed research");
    p.put(".verid/design.md", "Agreed design");
    p.put(".verid/spec.md", "- REQ-1: A screen\n");
    p.put(
      ".verid/plan.md",
      readyModulePlan(p.root, "## Module: screen\n- AC-1: A screen (REQ-1)\n"),
    );
    for (const name of ["a", "b", "c"]) p.put(`${base}/option-${name}.html`, `<h1>${name}</h1>`);
    p.put(`${base}/private.txt`, "private");
  },
});
const cli = (...args: string[]) => runCli(["mockup", ...args], p.root);

it("lists sorted HTML options and only a valid current choice", async () => {
  for (const value of [
    null,
    "broken",
    {},
    { choice: "option-a", note: "spacing", at: "2026-01-01" },
  ]) {
    if (value !== null)
      p.put(`${base}/choice.json`, typeof value === "string" ? value : JSON.stringify(value));
    const result = await cli("screen");
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/option-a[\s\S]*option-b[\s\S]*option-c/);
    expect(result.stdout).not.toContain("private.txt");
    expect(result.stdout.includes("Current: option-a")).toBe(
      typeof value === "object" && value !== null && "choice" in value,
    );
  }
});

it("writes and replaces the selection in the existing JSON format with optional notes", async () => {
  p.put(`${base}/Option-D.html`, "<h1>d</h1>");
  for (const [option, note, canonical] of [
    ["option-a", undefined, "option-a"],
    ["option-b.html", "Prefer spacing", "option-b"],
    ["option-c", "x".repeat(1000), "option-c"],
    ["OPTION-A", undefined, "option-a"],
    ["OPTION-B.HTML", undefined, "option-b"],
    ["option-d", undefined, "Option-D"],
  ] as const) {
    const result = await cli("screen", option!, ...(note === undefined ? [] : ["--note", note]));
    expect(result.code, result.stderr).toBe(0);
    const value = JSON.parse(p.read(`${base}/choice.json`));
    expect(value).toEqual({
      choice: canonical,
      note: note ?? "",
      at: expect.any(String),
    });
    expect(new Date(value.at).toISOString()).toBe(value.at);
    expect(p.read(`${base}/choice.json`)).toBe(JSON.stringify(value, null, 2) + "\n");
  }
});

it("preserves filesystem and unexpected errors when saving a mockup choice", () => {
  for (const code of ["EPERM", "EBUSY", "EACCES", "ENOSPC", undefined]) {
    const error = Object.assign(new Error("save failed"), { code });
    const save = vi.spyOn(mockups, "chooseMockup").mockImplementation(() => {
      throw error;
    });
    try {
      expect(() => mockupCommand(p.root, ["screen", "option-a"])).toThrow(error);
    } finally {
      save.mockRestore();
    }
    expect(existsSync(p.path(`${base}/choice.json`))).toBe(false);
  }
});

it("refuses unknown or unsafe options and lists the available options", async () => {
  for (const args of [
    ["screen", "missing"],
    ["screen", "../private"],
    ["screen", "/private.html"],
    ["screen", "C:\\private.html"],
    ["screen", "..%2fprivate.html"],
    ["screen", "private.txt"],
  ]) {
    const result = await cli(...args);
    expect(result.code, JSON.stringify(args)).toBe(2);
    expect(existsSync(p.path(`${base}/choice.json`))).toBe(false);
  }
  const missing = await cli("screen", "missing");
  for (const name of ["option-a", "option-b", "option-c"]) expect(missing.stderr).toContain(name);
});

it("refuses missing or empty mockup directories with an available-options message", async () => {
  mkdirSync(p.path(".verid/artifacts/03-modules/empty/ui/mockups"), { recursive: true });
  for (const args of [["missing"], ["missing", "option-a"], ["empty"], ["empty", "option-a"]]) {
    const result = await cli(...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Available options:");
  }
});

it("refuses invalid module names before writing", async () => {
  for (const name of ["../screen", "Screen", "a_b", "a--b", "", "a/b", "-screen", "screen-"]) {
    const result = await cli(name, "option-a");
    expect(result.code, name).toBe(2);
    expect(result.stderr).toContain("VERID_BURNT_MOCKUP_INVALID");
    expect(existsSync(p.path(`${base}/choice.json`))).toBe(false);
  }
});

it("refuses invalid notes without changing a previous choice", async () => {
  expect((await cli("screen", "option-a")).code).toBe(0);
  const before = p.read(`${base}/choice.json`);
  for (const note of ["x".repeat(1001), "bad\rnote", "bad\nnote", "bad\0note"]) {
    expect((await cli("screen", "option-b", "--note", note)).code).toBe(2);
    expect(p.read(`${base}/choice.json`)).toBe(before);
  }
});

it("refuses malformed command arguments without writing", async () => {
  for (const args of [
    [],
    ["screen", "option-a", "--note"],
    ["screen", "option-a", "--bad", "text"],
    ["screen", "option-a", "--note", "text", "extra"],
  ]) {
    expect((await cli(...args)).code).toBe(2);
    expect(existsSync(p.path(`${base}/choice.json`))).toBe(false);
  }
});

it("refuses linked directory components, HTML files and choice files", async () => {
  for (const relative of [
    base,
    `${base}/option-a.html`,
    `${base}/choice.json`,
    ".verid/artifacts/03-modules/screen",
    ".verid/artifacts/03-modules/screen/ui",
    ".verid/artifacts/03-modules",
    ".verid/artifacts",
  ]) {
    p.fresh();
    const target = p.path(relative);
    if (existsSync(target)) rmSync(target, { recursive: true });
    const outside = p.path("outside");
    mkdirSync(outside);
    symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir");
    for (const args of [["screen"], ["screen", "option-a"]]) {
      const result = await cli(...args);
      expect(result.code, relative).toBe(2);
      expect(result.stderr, relative).toContain("VERID_BURNT_MOCKUP_INVALID");
    }
  }
});

it("refuses developer selections in every recognized agent shell", async () => {
  for (const key of ["CLAUDECODE", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_TOOL_CALL_ID"]) {
    for (const args of [["screen"], ["screen", "option-a"]]) {
      const result = await runCli(["mockup", ...args], p.root, { [key]: "1" });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("VERID_BURNT_MOCKUP_IN_AGENT");
    }
  }
});

it("invalidates an ordered module when a choice is created, replaced or removed", async () => {
  const plan = () => {
    const value = readPlan(p.root, false, true);
    if (!value?.ok) throw new Error("fixture plan invalid");
    return value;
  };
  const original = plan().hashes.screen;
  for (const option of ["option-a", "option-b", null]) {
    expect((await runCli(["order", "screen"], p.root)).code).toBe(0);
    const before = plan().hashes.screen;
    if (option === null) rmSync(p.path(`${base}/choice.json`));
    else expect((await cli("screen", option)).code).toBe(0);
    expect(plan().hashes.screen).not.toBe(before);
    expect(
      planViews(p.root, plan(), p.loadState()).find((view) => view.name === "screen")?.phase,
    ).toBe("planned");
  }
  expect(plan().hashes.screen).toBe(original);
});

it("documents the developer mockup command in both languages", async () => {
  for (const language of ["en", "vi"]) {
    p.seed({ language });
    expect((await runCli(["help"], p.root)).stdout).toContain("verid mockup <module> [option]");
  }
});
