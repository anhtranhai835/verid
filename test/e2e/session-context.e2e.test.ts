import { readyModulePlan } from "./helpers.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { defaultRoles } from "../../src/core/manifest.js";
import { runCli, runHook } from "./in-process.js";

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-context-"));
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

function setup(lang = "en", extra = {}) {
  writeFileSync(
    join(project, ".verid/manifest.yaml"),
    stringify({
      schemaVersion: 1,
      mode: "prep",
      providers: ["claude-code"],
      roles: defaultRoles(["claude-code"]),
      repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
      ...extra,
    }),
  );
  writeFileSync(
    join(project, ".verid/.state/state.json"),
    JSON.stringify({ schemaVersion: 1, language: lang }),
  );
}
const session = (source: string, provider = "claude-code") =>
  runHook(
    JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "context",
      transcript_path: null,
      cwd: project,
      source,
      model: "test",
      permission_mode: "default",
    }),
    {},
    provider === "codex" ? ["--provider", "codex"] : [],
  );

it("keeps startup, clear and compact context below the budget with long paths, five repos and iterations", async () => {
  const repos = ["api", "web", "jobs", "shared", "e2e"].map((name) => ({
    path: `${name}-${"long-directory-name-".repeat(5)}`,
    source_globs: ["src/**"],
    test_globs: ["test/**"],
  }));
  for (const repo of repos) mkdirSync(join(project, repo.path));
  for (const provider of ["claude-code", "codex"])
    for (const lang of ["vi", "en"]) {
      setup(lang, {
        providers: [provider],
        roles: defaultRoles([provider as "claude-code" | "codex"]),
        layout: "workspace",
        repos,
        drive: "auto",
        iterations: { duration: "2 weeks", start_date: "2026-10-12", demo_day: "Friday" },
      });
      for (const source of ["startup", "clear", "compact"]) {
        const result = await session(source, provider);
        const context =
          provider === "codex"
            ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext
            : result.stdout;
        expect(result.code, result.stderr).toBe(0);
        expect(context).toContain("drive auto");
        expect(context).toContain("iteration");
        expect([...context].length, `${provider} ${lang} ${source}`).toBeLessThanOrEqual(10_000);
      }
    }
});

it("shows the runnable CLI command only once and keeps an ordinary startup within 3000 characters", async () => {
  setup();
  const result = await session("startup");
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout.match(/node "[^"\n]*cli\.js"/g)).toHaveLength(1);
  expect(result.stdout).toContain("verid:build");
  expect(result.stdout).toContain("tester verid:tester");
  expect([...result.stdout].length).toBeLessThanOrEqual(3000);
});

it("resumes with status and next step, preserving the cycle and omitting startup instructions for both providers", async () => {
  for (const provider of ["claude-code", "codex"]) {
    setup("en", { providers: [provider] });
    const file = join(project, ".verid/.state/state.json");
    const prior = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({ ...prior, tdd: { state: "PLATED", stub: false, last_run: "green" } }),
    );
    const result = await session("resume", provider);
    const context =
      provider === "codex"
        ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext
        : result.stdout;
    expect(result.code, result.stderr).toBe(0);
    expect(context).toContain("TDD PLATED");
    expect(context).toContain("Next:");
    expect(context).not.toContain("roles tester");
    expect(context).not.toContain("Mode prep:");
    expect(context).not.toContain("RAW = RED");
    expect([...context].length).toBeLessThanOrEqual(1000);
    expect(JSON.parse(readFileSync(file, "utf8")).tdd.state).toBe("PLATED");
  }
});

it("names the runnable CLI only once when remix resume needs baseline commands", async () => {
  setup("en", { mode: "remix" });
  const result = await session("resume");
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("No baseline yet");
  expect(result.stdout).toContain("verid stock");
  expect(result.stdout.match(/node "[^"\n]*cli\.js"/g)).toHaveLength(1);
});

it("bounds session context for a large plan while pointing to the full menu", async () => {
  setup();
  writeFileSync(join(project, ".verid/research.md"), "# Research\n");
  writeFileSync(join(project, ".verid/design.md"), "# Design\n");
  const modules = Array.from(
    { length: 200 },
    (_, i) => `## Module: module-${i}\n- AC-${i + 1}: observable behaviour\n`,
  );
  writeFileSync(join(project, ".verid/plan.md"), modules.join("\n"));
  const result = await session("compact");
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("verid menu");
  expect([...result.stdout].length).toBeLessThanOrEqual(3000);
});

it("points every session at the open module's log, and lets the main thread write it in RAW", async () => {
  setup("en");
  for (const [file, text] of [
    ["research.md", "# Research\n"],
    ["spec.md", "# Spec\n"],
    ["design.md", "# Design\n"],
    ["plan.md", "## Module: calc\n- AC-1: adds\n"],
  ] as const)
    writeFileSync(
      join(project, ".verid", file),
      file === "plan.md" ? readyModulePlan(project, text) : text,
    );
  const closed = await runHook(
    JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "planning-context",
      cwd: project,
      source: "startup",
    }),
  );
  expect(closed.stdout).not.toContain(".verid/log/");
  expect((await runCli(["order", "calc"], project)).code).toBe(0);
  for (const source of ["startup", "clear", "compact", "resume"]) {
    const r = await session(source);
    expect(r.stdout, source).toContain("verid: log .verid/log/calc.md");
  }
  const write = await runHook(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "context",
      cwd: project,
      tool_name: "Write",
      tool_input: { file_path: join(project, ".verid/log/calc.md"), content: "## 2026-11-05\n" },
    }),
    { CLAUDE_PROJECT_DIR: project },
  );
  expect([write.code, write.stderr]).toEqual([0, ""]);
});

it("leaves the skill guide and the role notes to the instruction block", async () => {
  setup("en");
  const r = await session("startup");
  expect(r.code, r.stderr).toBe(0);
  for (const gone of ["Use verid:tdd for implementation", "the hook enforces ownership"])
    expect(r.stdout, gone).not.toContain(gone);
  for (const kept of ["verid: TDD RAW", "verid: roles reviewer", "Mode prep:", "Next:"])
    expect(r.stdout, kept).toContain(kept);
});
