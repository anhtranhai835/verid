import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { tempProject } from "../support/project.js";
import { readyModulePlan, developerEnv } from "./helpers.js";
import { runCli, runHook, runReview } from "./in-process.js";
import { runGit } from "../../src/adapters/git.js";
import { readState, statePaths } from "../../src/adapters/state-store.js";
import { resolveProject } from "../../src/adapters/project.js";
import { boardSnapshot } from "../../src/adapters/kanban.js";
import { stationDiagnostics, scheduleStations } from "../../src/adapters/station.js";
import { autoFactsOf } from "../../src/adapters/plan-file.js";
import { loadManifest } from "../../src/adapters/manifest.js";
import { writeState } from "../../src/adapters/state-store.js";
import { RUNNER } from "../support/fixtures.js";

const t = tempProject("verid-station-", {
  subdir: "project",
  state: { schemaVersion: 1, language: "en" },
  setup: (p) => {
    p.contextSetup("en", {
      providers: ["codex"],
      roles: { reviewer: ["verid_reviewer"] },
      repos: [
        {
          path: ".",
          source_globs: ["src/**"],
          test_globs: ["test/**"],
          test_cmd: `"${process.execPath}" "${RUNNER}" {junit}`,
        },
      ],
    });
    p.put(".verid/.gitignore", ".state/\n");
    p.put(
      ".gitignore",
      ".codex/hooks.json\n.claude/settings.local.json\nscenario.json\n.verid-test-results.xml\n",
    );
    p.put(".verid/research.md", "# Research\nIndependent functions\n");
    p.put(".verid/design.md", "# Design\nPure functions\n");
    p.put(".verid/spec.md", "- REQ-1: add\n- REQ-2: subtract\n");
    p.put(
      ".verid/plan.md",
      readyModulePlan(
        p.dir,
        "## Module: identity\nBoundary: src/identity/**, test/identity/**\n- AC-1: adds (REQ-1)\n\n## Module: billing\nBoundary: src/billing/**, test/billing/**\n- AC-2: subtracts (REQ-2)\n",
      ),
    );
    git(p.dir, "init", "-b", "main");
    git(p.dir, "config", "user.email", "test@example.com");
    git(p.dir, "config", "user.name", "Test");
    git(p.dir, "add", ".");
    git(p.dir, "commit", "-m", "chore: create project");
  },
});

function put(cwd: string, file: string, text: string) {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), text);
}
function scenario(cwd: string, junit = "vitest-ac.xml", exit = 0) {
  put(cwd, "scenario.json", JSON.stringify({ junit, exit, output: "fixture runner" }));
}
async function finish(cwd: string, module: string, ac = "AC-1") {
  await hook(cwd, module, "SessionStart", { source: "startup" });
  const test = `test/${module}/value.test.ts`,
    source = `src/${module}/value.ts`;
  expect((await write(cwd, module, test)).code).toBe(0);
  put(cwd, test, `// ${ac} fixture\n`);
  scenario(cwd, "vitest-add-assert.xml", 1);
  expect((await cli(cwd, "taste")).code).toBe(1);
  expect(state(cwd).tdd.state).toBe("COOKING");
  expect((await write(cwd, module, test)).stderr).toContain("VERID_BURNT_TDD_TEST_FROZEN");
  expect((await write(cwd, module, source)).code).toBe(0);
  put(cwd, source, "export const value = 1;\n");
  scenario(cwd, ac === "AC-1" ? "vitest-ac.xml" : "vitest-ac2-unit.xml");
  expect((await cli(cwd, "taste")).code).toBe(0);
  expect(state(cwd).tdd.state).toBe("PLATED");
  expect((await cli(cwd, "serve", module)).code).toBe(2);
  git(cwd, "add", "src", "test");
  git(cwd, "commit", "-m", `feat(${module}): add value`);
  await runReview(
    JSON.stringify({
      hook_event_name: "SubagentStop",
      cwd,
      session_id: module,
      agent_id: `review-${module}`,
      agent_type: "verid_reviewer",
      last_assistant_message: `${ac} checked against spec, tests and implementation.\nVerdict: pass`,
    }),
    { CLAUDE_PROJECT_DIR: t.dir },
  );
  const served = await cli(cwd, "serve", module);
  expect(served.code, served.stderr).toBe(0);
}

it("serves independent stations and counts them done only after merged tests pass", async () => {
  const a = await open("identity"),
    b = await open("billing");
  await finish(a, "identity");
  expect(state(b).tdd).toMatchObject({ state: "RAW", last_run: null });
  await finish(b, "billing", "AC-2");
  expect(state(t.dir).modules.identity?.served_at).toBeNull();
  expect((await boardSnapshot(t.dir)).tasks.every((task) => task.column === "progress")).toBe(true);
  scenario(t.dir);
  const first = await cli(t.dir, "station", "close", "identity");
  expect(first.code, first.stderr).toBe(0);
  expect(existsSync(a)).toBe(false);
  expect(state(t.dir).modules.identity?.work?.["."]?.integrated).toBe(
    git(t.dir, "rev-parse", "HEAD"),
  );
  expect(
    existsSync(
      join(t.dir, ".verid/.state/stations/identity", git(t.dir, "rev-parse", "HEAD"), "state.json"),
    ),
  ).toBe(true);
  const usage = await cli(t.dir, "usage", "identity", "--json");
  expect(JSON.parse(usage.stdout)[0].taste).toBeGreaterThanOrEqual(3);
  expect(state(t.dir).modules.billing?.served_at).toBeNull();
  scenario(t.dir, "vitest-ac2-unit.xml");
  const second = await cli(t.dir, "station", "close", "billing");
  expect(second.code, second.stderr).toBe(0);
  expect(state(t.dir).stations).toEqual({});
  expect((await boardSnapshot(t.dir)).tasks.every((task) => task.column === "done")).toBe(true);
});

it("retains the station and leaves the parent incomplete when merged tests fail", async () => {
  const a = await open("identity");
  await finish(a, "identity");
  const before = git(t.dir, "rev-parse", "HEAD");
  scenario(t.dir, "vitest-add-assert.xml", 1);
  expect((await cli(t.dir, "station", "close", "identity")).stderr).toContain(
    "VERID_BURNT_STATION_INTEGRATION",
  );
  expect(existsSync(a)).toBe(true);
  expect(state(t.dir).modules.identity?.served_at).toBeNull();
  expect(state(t.dir).modules.identity?.work?.["."]?.integrated).toBeUndefined();
  expect(state(t.dir).stations.identity?.stage).toBe("open");
  expect(git(t.dir, "rev-parse", "HEAD")).toBe(before);
  expect(state(t.dir).tdd.last_run).toBeNull();
});

it("requires the module ACs in merged evidence even when a different suite is green", async () => {
  const a = await open("identity");
  await finish(a, "identity");
  scenario(t.dir, "vitest-ac2-unit.xml");
  expect((await cli(t.dir, "station", "close", "identity")).stderr).toContain(
    "VERID_BURNT_STATION_INTEGRATION",
  );
  expect(state(t.dir).modules.identity?.served_at).toBeNull();
  expect(existsSync(a)).toBe(true);
});

it("lists squash conflicts and keeps the station without resolving files", async () => {
  const a = await open("identity");
  await finish(a, "identity");
  put(t.dir, "src/identity/value.ts", "export const value = 2;\n");
  git(t.dir, "add", "src");
  git(t.dir, "commit", "-m", "fix(identity): change value");
  const conflict = await cli(t.dir, "station", "close", "identity");
  expect(conflict.stderr).toContain("VERID_BURNT_STATION_INTEGRATION");
  expect(conflict.stderr).toContain("src/identity/value.ts");
  expect(readFileSync(join(t.dir, "src/identity/value.ts"), "utf8")).toContain("value = 2");
  expect(existsSync(a)).toBe(true);
  expect(state(t.dir).modules.identity?.served_at).toBeNull();
});
function git(cwd: string, ...args: string[]) {
  const r = runGit(cwd, args);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
const cli = (cwd: string, ...args: string[]) => runCli(args, cwd, developerEnv());
const state = (cwd: string) => readState(statePaths(cwd));
const hook = (cwd: string, session: string, event: string, extra = {}) =>
  runHook(
    JSON.stringify({
      hook_event_name: event,
      cwd,
      session_id: session,
      ...extra,
    }),
    { CLAUDE_PROJECT_DIR: t.dir },
  );
const write = (cwd: string, session: string, file: string) =>
  hook(cwd, session, "PreToolUse", {
    tool_name: "Write",
    tool_input: { file_path: file, content: "content" },
  });
async function open(name: string) {
  const ordered = await cli(t.dir, "order", name);
  expect(ordered.code, ordered.stderr).toBe(0);
  const result = await cli(t.dir, "station", name);
  expect(result.code, result.stderr).toBe(0);
  return state(t.dir).stations[name]!.path;
}

it("resolves a registered worktree from cwd and ignores an inherited main project", async () => {
  const a = await open("identity");
  mkdirSync(join(a, "src", "identity"), { recursive: true });
  expect(resolveProject(join(a, "src/identity"), t.dir)).toBe(a);
  expect(resolveProject(a.toUpperCase(), t.dir)).toBe(process.platform === "win32" ? a : t.dir);
  const alias = join(t.root, "alias");
  symlinkSync(a, alias, process.platform === "win32" ? "junction" : "dir");
  expect(resolveProject(alias, t.dir)).toBe(a);
  mkdirSync(join(a, "src/identity/.verid"));
  expect(resolveProject(join(a, "src/identity"), t.dir)).toBe(a);
  expect(state(a).modules.identity).toEqual(state(t.dir).modules.identity);
  expect(state(a).modules.billing).toBeUndefined();
  expect(existsSync(join(a, ".codex/hooks.json"))).toBe(true);
});

it("preserves signed input bytes when Git checks out different line endings", async () => {
  git(t.dir, "config", "core.autocrlf", "true");
  const a = await open("identity");
  expect(state(a).modules.identity?.sha256).toBe(state(t.dir).modules.identity?.sha256);
  expect(readFileSync(join(a, ".verid/plan.md"), "utf8")).toBe(t.read(".verid/plan.md"));
  expect(git(a, "status", "--porcelain")).toBe("");
});

it("refuses unregistered worktrees and developer commands from an agent", async () => {
  await open("identity");
  const unknown = join(t.root, "unknown");
  git(t.dir, "worktree", "add", "-b", "feat/unknown", unknown);
  expect(() => resolveProject(unknown, t.dir)).toThrow("VERID_BURNT_STATION_UNREGISTERED");
  expect((await runCli(["station", "billing"], t.dir, { CLAUDECODE: "1" })).stderr).toContain(
    "VERID_BURNT_STATION_IN_AGENT",
  );
});

it("isolates write boundaries, TDD state and session ownership across stations", async () => {
  const a = await open("identity");
  const b = await open("billing");
  await hook(a, "a", "SessionStart", { source: "startup" });
  await hook(b, "b", "SessionStart", { source: "startup" });
  expect((await write(a, "a", "src/identity/value.ts")).stderr).toContain(
    "VERID_BURNT_TDD_NO_FAILING_TEST",
  );
  expect((await write(a, "a", "test/identity/value.test.ts")).code).toBe(0);
  const alias = join(t.root, "station-alias");
  symlinkSync(a, alias, process.platform === "win32" ? "junction" : "dir");
  expect((await write(a, "a", join(alias, "test/identity/alias.test.ts"))).code).toBe(0);
  expect((await write(a, "a", "src/billing/value.ts")).stderr).toContain(
    "VERID_BURNT_STATION_WRITE",
  );
  expect((await write(t.dir, "main", "src/identity/value.ts")).stderr).toContain(
    "VERID_BURNT_STATION_WRITE",
  );
  expect((await write(a, "a", join(b, "src/billing/value.ts"))).stderr).toContain(
    "VERID_BURNT_STATION_WRITE",
  );
  const link = join(a, "src/identity/link");
  mkdirSync(join(a, "src/identity"), { recursive: true });
  symlinkSync(b, link, process.platform === "win32" ? "junction" : "dir");
  expect((await write(a, "a", join(link, "test/billing/value.test.ts"))).stderr).toContain(
    "VERID_BURNT_STATION_WRITE",
  );
  const command = await hook(a, "a", "PreToolUse", {
    tool_name: "Bash",
    tool_input: { command: "python change_files.py" },
  });
  expect(command.stderr).toContain("VERID_BURNT_STATION_COMMAND");
  await hook(b, "a", "SessionStart", { source: "startup" });
  expect((await write(b, "a", "test/billing/value.test.ts")).stderr).toContain(
    "VERID_BURNT_STATION_SESSION",
  );
  const review = await hook(b, "a", "SubagentStart", {
    agent_id: "foreign",
    agent_type: "verid_reviewer",
  });
  expect(review.stderr).toContain("VERID_BURNT_STATION_SESSION");
  expect(state(b).review_jobs).toEqual({});
  expect(state(a).tdd.state).toBe("RAW");
  expect(state(b).tdd).toMatchObject({ state: "RAW", last_run: null });
  const board = await boardSnapshot(t.dir);
  expect(board.tasks.filter((task) => task.station).map((task) => task.id)).toEqual([
    "identity",
    "billing",
  ]);
  expect(
    board.tasks.every((task) => task.column === "progress" && task.station?.tdd === "RAW"),
  ).toBe(true);
});

it("keeps a plated station unchanged while another station records a new failure", async () => {
  const a = await open("identity"),
    b = await open("billing");
  await finish(b, "billing", "AC-2");
  const green = state(b);
  await hook(a, "identity", "SessionStart", { source: "startup" });
  expect((await write(a, "identity", "test/identity/value.test.ts")).code).toBe(0);
  put(a, "test/identity/value.test.ts", "// AC-1 adds\n");
  scenario(a, "vitest-add-assert.xml", 1);
  expect((await cli(a, "taste")).code).toBe(1);
  expect(state(a).tdd.state).toBe("COOKING");
  expect(state(b)).toEqual(green);
});

it("keeps station boundaries on native Codex and Antigravity payloads", async () => {
  const a = await open("identity");
  const codex = await runHook(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      cwd: a,
      session_id: "native-codex",
      transcript_path: null,
      model: "test",
      permission_mode: "default",
      turn_id: "turn",
      tool_use_id: "call",
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Add File: src/billing/value.ts\n+value\n*** End Patch",
      },
    }),
    { CLAUDE_PROJECT_DIR: t.dir },
    ["--provider", "codex"],
  );
  expect(codex.stdout).toContain("VERID_BURNT_STATION_WRITE");
  const antigravity = await runHook(
    JSON.stringify({
      conversationId: "native-agy",
      workspacePaths: [a],
      toolCall: {
        name: "write_to_file",
        args: { TargetFile: join(a, "src/billing/value.ts"), CodeContent: "value" },
      },
    }),
    {},
    ["--provider", "antigravity", "--event", "PreToolUse"],
  );
  expect(antigravity.stdout + antigravity.stderr).toContain("VERID_BURNT_STATION_WRITE");
});

it("rewires the committed pinned runtime and keeps its station gates", async () => {
  t.editManifest((manifest) => {
    manifest.resources = "repo";
  });
  const cooked = await cli(t.dir, "cook", "--yes");
  expect(cooked.code, cooked.stderr).toBe(0);
  git(t.dir, "add", ".");
  git(t.dir, "commit", "-m", "chore: pin harness resources");
  const a = await open("identity");
  expect(readFileSync(join(a, ".verid/hooks/hook.js"), "utf8")).toBe(
    t.read(".verid/hooks/hook.js"),
  );
  expect(readFileSync(join(a, ".codex/hooks.json"), "utf8")).toContain(a.replaceAll("\\", "\\\\"));
  const result = spawnSync(process.execPath, [join(a, ".verid/hooks/hook.js")], {
    cwd: a,
    env: { ...developerEnv(), CLAUDE_PROJECT_DIR: t.dir },
    encoding: "utf8",
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      cwd: a,
      session_id: "pinned",
      tool_name: "Write",
      tool_input: { file_path: "src/billing/value.ts", content: "x" },
    }),
  });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("VERID_BURNT_STATION_WRITE");
});

it("reports missing branches, worktrees and changed approvals", async () => {
  const a = await open("identity");
  expect(stationDiagnostics(t.dir)).toEqual([]);
  writeFileSync(join(a, ".verid/design.md"), "changed");
  expect(stationDiagnostics(t.dir).join("\n")).toContain("approval");
  git(t.dir, "worktree", "remove", "--force", a);
  git(t.dir, "branch", "-D", "feat/identity");
  expect(stationDiagnostics(t.dir).join("\n")).toContain("worktree");
  expect(stationDiagnostics(t.dir).join("\n")).toContain("branch");
});

it("refuses a dependency whose served approval no longer matches its plan", async () => {
  const a = await open("identity");
  await finish(a, "identity");
  scenario(t.dir);
  const closed = await cli(t.dir, "station", "close", "identity");
  expect(closed.code, closed.stderr).toBe(0);
  t.put(
    ".verid/plan.md",
    t
      .read(".verid/plan.md")
      .replace("- AC-1: adds", "- AC-1: adds whole numbers")
      .replace("Boundary: src/billing/**", "Depends: identity\nBoundary: src/billing/**"),
  );
  git(t.dir, "add", ".verid/plan.md");
  git(t.dir, "commit", "-m", "docs: refine module contract");
  expect((await cli(t.dir, "order", "billing")).code).toBe(0);
  expect((await cli(t.dir, "station", "billing")).stderr).toContain(
    "VERID_BURNT_STATION_DEPENDENCY",
  );
});

it("opens the next independent signed modules up to the parallel drive limit", async () => {
  t.editManifest((manifest) => {
    manifest.drive = "no-brain";
    manifest.stations = 2;
  });
  t.put(
    ".verid/plan.md",
    readyModulePlan(
      t.dir,
      t.read(".verid/plan.md") + "\n## Module: product\n- AC-9 (e2e): whole product\n",
    ),
  );
  git(t.dir, "add", ".verid");
  git(t.dir, "commit", "-m", "feat: enable independent work");
  expect((await cli(t.dir, "order")).code).toBe(0);
  const manifest = (await loadManifest(t.dir))!;
  const before = state(t.dir);
  const facts = autoFactsOf(t.dir, before, false, true, manifest.stations);
  writeState(statePaths(t.dir), {
    ...before,
    auto: { ...before.auto, plan_sha256: facts.planHash },
  });
  scheduleStations(t.dir, manifest);
  expect(Object.keys(state(t.dir).stations)).toEqual(["identity", "billing"]);
  const a = state(t.dir).stations.identity!.path,
    b = state(t.dir).stations.billing!.path;
  const blocked = state(a);
  writeState(statePaths(a), { ...blocked, auto: { ...blocked.auto, coder_rounds: { "AC-1": 3 } } });
  scheduleStations(t.dir, manifest);
  expect(state(t.dir).auto.coder_rounds).toEqual({});
  expect(state(b).auto.coder_rounds).toEqual({});
  expect(state(b).modules.billing?.served_at).toBeNull();
  expect(state(t.dir).stations.product).toBeUndefined();
});
