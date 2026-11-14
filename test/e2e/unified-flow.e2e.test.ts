import { tempProject } from "../support/project.js";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";

import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { autoPhase } from "../../src/core/auto.js";
import { parsePlan } from "../../src/core/plan.js";
import { defaultRoles } from "../../src/core/manifest.js";
import { boardSnapshot, saveBoardDocument } from "../../src/adapters/kanban.js";
import {
  autoFactsOf,
  MODULE_INPUTS,
  readPlan,
  servedSections,
} from "../../src/adapters/plan-file.js";
import { statePaths, writeState } from "../../src/adapters/state-store.js";
import { planCook } from "../../src/cli/init.js";
import { startBoard } from "../../src/cli/board.js";
import { boardHtml } from "../../src/cli/board-page.js";
import { readyModulePlan, startTaskSession } from "./helpers.js";
import { runReview } from "./in-process.js";

let fixture: string;
let project: string;
let server: Awaited<ReturnType<typeof startBoard>> | undefined;

const roots = () =>
  parse(read(".verid/manifest.yaml")).repos.map((repo: { path: string }) => repo.path) as string[];
const t = tempProject("verid-v2-", {
  subdir: "project",
  cwd: () => project,
  claudeProject: false,
  cliEnv: () => ({ CODEX_HOME: join(fixture, "user-codex") }),
  payload: {
    model: "test",
    transcript_path: null,
    permission_mode: "default",
    turn_id: "turn",
    tool_use_id: "call",
  },
  bind: (p) => {
    fixture = p.root;
    project = join(fixture, "project");
  },
  setup: () => {
    vi.stubEnv("CODEX_HOME", join(fixture, "user-codex"));
  },
  teardown: async () => {
    await closeBoard();
    vi.unstubAllEnvs();
  },
});
const { read, put, loadState: state, cliBound: cli, sessionEvent: hook, payloadFor: payload } = t;
async function closeBoard() {
  if (!server) return;
  server.server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server!.server.close((error) => (error ? reject(error) : resolve())),
  );
  server = undefined;
}

async function cook(drive = "human", layout = "monorepo", mode = "prep") {
  if (layout === "workspace")
    for (const repo of ["api", "web"]) {
      mkdirSync(join(project, repo));
      const result = spawnSync("git", ["init", "-q", "-b", "main"], {
        cwd: join(project, repo),
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status, result.stderr).toBe(0);
    }
  const result = await planCook(project, {
    mode,
    drive,
    layout,
    providers: ["codex"],
    src: ["src/**"],
    tests: ["test/**"],
    testCmd: `"${process.execPath}" "${join(import.meta.dirname, "fake-runner.mjs")}" {junit}`,
  });
  expect(result.apply().failed).toBe(false);
  put(".verid/research.md", "Agreed arithmetic scope\n");
  put(".verid/design.md", "Pure arithmetic functions; no UI\n");
  put(".verid/spec.md", "- REQ-1: Add two numbers\n- REQ-2: Subtract two numbers\n");
}
function splitReady() {
  saveBoardDocument(project, "split");
  readyModulePlan(project, read(".verid/plan.md"));
}

const review = (session: string, id: string) =>
  runReview(
    payload("SubagentStop", session, {
      agent_id: id,
      agent_type: "verid_reviewer",
      stop_hook_active: false,
      last_assistant_message: "ACs, inputs, diff and tests checked.\nVerdict: pass",
      agent_transcript_path: null,
    }),
    {},
    ["--provider", "codex"],
  );
function scenario(exit: number, junit: string) {
  for (const root of roots())
    put(
      root === "." ? "scenario.json" : `${root}/scenario.json`,
      JSON.stringify({ exit, junit, output: "recorded runner evidence" }),
    );
}
async function changed(session: string, file: string) {
  const input = {
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+content\n*** End Patch` },
  };
  const allowed = await hook("PreToolUse", session, input);
  expect(allowed.stdout, allowed.stderr).toBe("");
  put(file, "// harness fixture change\n");
  await hook("PostToolUse", session, input);
}

it("AC-14, AC-15, AC-18, AC-19: all planned projects have a board and splitting creates real unfinished dossiers", async () => {
  await cook();
  saveBoardDocument(project, "split");
  const snapshot = await boardSnapshot(project);
  expect(snapshot.drive).toBe("human");
  expect(snapshot.tasks).toHaveLength(3);
  for (const task of snapshot.tasks) {
    expect(task.text).toContain(`Artifacts: .verid/artifacts/03-modules/${task.id}`);
    expect(task.dossier.unresolved).toBeGreaterThan(0);
    expect(task.reason).toContain("resolve the module draft");
    expect(
      existsSync(join(project, `.verid/artifacts/03-modules/${task.id}/ba/requirements.md`)),
    ).toBe(true);
  }
  expect((await cli("order", "req-1")).code).toBe(2);
});

it("AC-15: remix displays a no-task notice and leaves baseline gates unchanged", async () => {
  await cook("human", "monorepo", "remix");
  expect(await boardSnapshot(project)).toMatchObject({
    tasks: [],
    notice: expect.stringContaining("remix"),
  });
  expect(existsSync(join(project, ".verid/artifacts"))).toBe(false);
});

it("AC-17: the board is self-contained and adds no runtime dependency", () => {
  for (const lang of ["en", "vi"] as const)
    expect(boardHtml(lang)).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8"));
  expect(pkg.dependencies).toBeUndefined();
});

it.each(["human", "ai"])(
  "AC-8: %s drive blocks unfinished dossiers, missing inputs and missing Artifacts from module work",
  async (drive) => {
    await cook(drive);
    saveBoardDocument(project, "split");
    const blocked = async (detail: string) => {
      const result = drive === "human" ? await cli("order", "req-1") : await cli("order");
      if (drive === "human") {
        expect(result.code).toBe(2);
        expect(result.stderr).toContain(detail);
      } else {
        // AI signs the research/design before planning, without approving any module yet.
        expect(result.code, result.stderr).toBe(0);
        const current = state();
        expect(autoPhase(autoFactsOf(project, current, false, true))).toMatchObject({
          kind: "plan",
          problem: expect.stringContaining(detail),
        });
        expect(Object.keys(current.modules)).toEqual([]);
        expect(current.auto.work).toBeNull();
        const denied = await hook("PreToolUse", "draft-session", {
          tool_name: "apply_patch",
          tool_input: {
            command: "*** Begin Patch\n*** Add File: src/blocked.ts\n+code\n*** End Patch",
          },
        });
        expect(denied.stdout).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
      }
    };
    await blocked("resolve the module draft before order");

    readyModulePlan(project, read(".verid/plan.md"));
    const input = `.verid/artifacts/03-modules/req-1/${MODULE_INPUTS[0]}`;
    rmSync(join(project, input));
    await blocked(`${input}: missing module input`);

    put(input, "Agreed module requirements\n");
    put(
      ".verid/plan.md",
      read(".verid/plan.md").replace("Artifacts: .verid/artifacts/03-modules/req-1\n", ""),
    );
    await blocked("req-1: requires Artifacts");
  },
);

it.each(["human", "ai"])(
  "AC-13: %s SessionStart describes module dossiers, board priorities and its session rule",
  async (drive) => {
    await cook(drive);
    splitReady();
    expect((await (drive === "human" ? cli("order", "req-1") : cli("order"))).code).toBe(0);
    const startup = await hook("SessionStart", "instruction-session", { source: "startup" });
    expect(startup.code, startup.stderr).toBe(0);
    const context = JSON.parse(startup.stdout).hookSpecificOutput.additionalContext;
    expect(context).toContain("module dossiers in .verid/artifacts/03-modules/<name>");
    expect(context).toContain("required before order");
    expect(context).toContain("verid board for priorities");
    if (drive === "human") {
      expect(context).toContain("ONE TASK PER SESSION");
      expect(context).toContain("Never start another task in this session");
    } else {
      expect(context).toContain("AI drive follows the developer's priority queue in one session");
      expect(context).toContain("Finish the current task before moving to the next");
      expect(context).not.toContain("ONE TASK PER SESSION");
    }
  },
);

async function launch() {
  server = await startBoard(project, async (command, task) => {
    const result = await cli(command, ...(task ? [task] : []));
    return { exit: result.code, stdout: result.stdout, stderr: result.stderr };
  });
  return {
    Authorization: `Bearer ${server.token}`,
    "Content-Type": "application/json",
    Origin: server.origin,
  };
}
const post = (headers: Record<string, string>, body: unknown) =>
  fetch(`${server!.origin}/api/action`, { method: "POST", headers, body: JSON.stringify(body) });

it.each(["human", "ai"])(
  "AC-20, AC-21: an unstarted constructor module can change priority in %s drive",
  async (drive) => {
    await cook(drive);
    splitReady();
    put(
      ".verid/plan.md",
      readyModulePlan(project, read(".verid/plan.md").replaceAll("req-2", "constructor")),
    );
    const headers = await launch();
    const before = await boardSnapshot(project);
    expect(before.tasks.find((task) => task.id === "constructor")).toMatchObject({
      column: "backlog",
      canMove: true,
    });
    expect(
      (
        await post(headers, {
          action: "move",
          task: "constructor",
          direction: "up",
          revision: before.revision,
        })
      ).status,
    ).toBe(200);
    expect((await boardSnapshot(project)).tasks.map((task) => task.id)).toEqual([
      "constructor",
      "req-1",
      "product",
    ]);
    expect(Object.hasOwn(state().modules, "constructor")).toBe(false);
  },
);

it("AC-20, AC-21, AC-22, AC-24, AC-27: priorities persist across board restart, match menu, and use all API guards", async () => {
  await cook();
  splitReady();
  const headers = await launch();
  const before = await boardSnapshot(project);
  const input = { action: "move", task: "req-2", direction: "up", revision: before.revision };
  expect((await post({ ...headers, Authorization: "Bearer wrong" }, input)).status).toBe(401);
  expect((await post({ ...headers, Origin: "https://example.test" }, input)).status).toBe(403);
  expect((await post(headers, { ...input, revision: "stale" })).status).toBe(409);
  expect((await post(headers, input)).status).toBe(200);
  expect((await post(headers, input)).status).toBe(409);
  let snapshot = await boardSnapshot(project);
  expect(snapshot.tasks.map((task) => task.id)).toEqual(["req-2", "req-1", "product"]);
  expect(snapshot.tasks[0]?.next).toBe(true);
  const menu = (await cli("menu")).stdout;
  expect(menu.indexOf("req-2 ·")).toBeLessThan(menu.indexOf("req-1 ·"));
  expect(
    (await post(headers, { ...input, task: "product", revision: snapshot.revision })).status,
  ).toBe(400);
  await closeBoard();
  await launch();
  expect((await boardSnapshot(project)).tasks.map((task) => task.id)).toEqual([
    "req-2",
    "req-1",
    "product",
  ]);
  expect((await cli("order", "req-1")).code).toBe(0); // human selection may ignore queue priority
  snapshot = await boardSnapshot(project);
  expect(snapshot.tasks.find((task) => task.id === "req-1")?.canMove).toBe(false);
  const currentHeaders = {
    Authorization: `Bearer ${server!.token}`,
    "Content-Type": "application/json",
    Origin: server!.origin,
  };
  expect(
    (await post(currentHeaders, { ...input, task: "req-1", revision: snapshot.revision })).status,
  ).toBe(400);
  await startTaskSession(project, "owner", "codex");
  expect(
    (
      await hook("PreToolUse", "owner", {
        tool_name: "apply_patch",
        tool_input: {
          command:
            "*** Begin Patch\n*** Update File: .verid/.state/state.json\n@@\n-a\n+b\n*** End Patch",
        },
      })
    ).stdout,
  ).toContain("VERID_BURNT_STATE_PROTECTED");
});

it("AC-16, AC-25, AC-26: AI follows priorities, preserves current work, and forbids manual selection or planning writes during work", async () => {
  await cook("ai");
  splitReady();
  const headers = await launch();
  const before = await boardSnapshot(project);
  expect(
    (
      await post(headers, {
        action: "move",
        task: "req-2",
        direction: "up",
        revision: before.revision,
      })
    ).status,
  ).toBe(200);
  expect((await cli("order")).code).toBe(0);
  await startTaskSession(project, "ai", "codex");
  await review("ai", "plan-review");
  let facts = autoFactsOf(project, state(), false, true);
  expect(autoPhase(facts)).toMatchObject({ kind: "module", view: { name: "req-2" } });
  const planHash = facts.planHash;
  const original = state();
  writeState(statePaths(project), {
    ...original,
    kanban: { ...original.kanban, queue: ["req-1", "req-2"] },
  });
  facts = autoFactsOf(project, state(), false, true);
  expect(facts.planHash).toBe(planHash);
  expect(autoPhase(facts)).toMatchObject({ kind: "module", view: { name: "req-2" } });
  const snapshot = await boardSnapshot(project);
  expect(snapshot.drive).toBe("auto");
  expect(
    (await post(headers, { action: "select", task: "req-1", revision: snapshot.revision })).status,
  ).toBe(409);
  expect(
    (
      await post(headers, {
        action: "plan",
        content: read(".verid/plan.md"),
        revision: snapshot.revision,
      })
    ).status,
  ).toBe(400);
  // This project has set no language, so the machine's is used.
  expect(() => saveBoardDocument(project, "spec", "- REQ-1: changed")).toThrow(
    /A task is open|Đang có task mở/,
  );
});

it.each([
  ["human", "monorepo"],
  ["ai", "monorepo"],
  ["human", "workspace"],
  ["ai", "workspace"],
])(
  "AC-9, AC-10, AC-31: %s drive completes two modules in %s through real order/TDD/review/serve gates",
  async (drive, layout) => {
    await cook(drive, layout);
    splitReady();
    const headers = await launch();
    const before = await boardSnapshot(project);
    expect(
      (
        await post(headers, {
          action: "move",
          task: "req-2",
          direction: "up",
          revision: before.revision,
        })
      ).status,
    ).toBe(200);
    if (drive === "ai") {
      expect((await cli("order")).code).toBe(0);
      await startTaskSession(project, "ai-session", "codex");
      await review("ai-session", "plan");
    }
    for (const [task, ac] of [
      ["req-2", 2],
      ["req-1", 1],
    ] as const) {
      const session = drive === "ai" ? "ai-session" : `${task}-session`;
      if (drive === "human") {
        expect((await cli("order", task)).code).toBe(0);
        await startTaskSession(project, session, "codex");
        expect(
          (
            await hook("PreToolUse", "intruder", {
              tool_name: "apply_patch",
              tool_input: {
                command: "*** Begin Patch\n*** Add File: test/other.ts\n+x\n*** End Patch",
              },
            })
          ).stdout,
        ).toContain("VERID_BURNT_TASK_SESSION");
      }
      const root = layout === "workspace" ? "api/" : "";
      await changed(session, `${root}test/${task}.test.ts`);
      scenario(1, "vitest-add-assert.xml");
      expect((await cli("taste")).code).toBe(1);
      await changed(session, `${root}src/${task}.ts`);
      scenario(0, ac === 1 ? "vitest-ac.xml" : "vitest-ac2-unit.xml");
      expect((await cli("taste")).code).toBe(0);
      await review(session, `review-${task}`);
      if (drive === "human") expect((await cli("serve", task)).code).toBe(0);
      expect(state().modules[task]?.served_at).toEqual(expect.any(String));
      expect((await boardSnapshot(project)).tasks.find((item) => item.id === task)).toMatchObject({
        column: "done",
        canMove: false,
      });
    }
    expect(
      (await boardSnapshot(project)).tasks.find((task) => task.id === "product"),
    ).toMatchObject({ next: drive === "human", canMove: false });
  },
);

it("AC-28, AC-29, AC-30: upgrade is previewable and idempotent, fills partial templates, and preserves served sections and evidence", async () => {
  const first = "## Module: served\r\n- AC-1: done\r\n\r\n";
  put(
    ".verid/manifest.yaml",
    stringify({
      schemaVersion: 1,
      mode: "prep",
      workflow: "classic",
      providers: ["codex"],
      roles: defaultRoles(["codex"]),
      repos: [
        {
          path: ".",
          source_globs: ["src/**"],
          test_globs: ["test/**"],
          test_cmd: `"${process.execPath}" "${join(import.meta.dirname, "fake-runner.mjs")}" {junit}`,
        },
      ],
    }),
  );
  put(
    ".verid/plan.md",
    first + "## Module: pending\r\nTitle: Work\r\nDepends: served\r\n- AC-2: pending\r\n",
  );
  put(".verid/templates/module/spec/spec.md", "Custom {{module}} contract\n");
  put(".verid/research.md", "Agreed\n");
  put(".verid/design.md", "Agreed\n");
  put(".verid/spec.md", "- REQ-1: done\n- REQ-2: pending\n");
  put(
    ".verid/.state/state.json",
    JSON.stringify({
      schemaVersion: 1,
      language: "en",
      modules: {
        served: {
          sha256: createHash("sha256").update(first).digest("hex"),
          acs: ["AC-1"],
          at: "t",
          served_at: "t",
        },
      },
      tdd: { state: "PLATED", last_run: "preserved", passed_acs: ["AC-1"] },
    }),
  );
  const evidence = read(".verid/.state/state.json");
  const originalPlan = read(".verid/plan.md");
  expect((await cli("doctor")).stdout).toContain("workflow: classic");
  expect((await cli("upgrade", "--dry-run")).code).toBe(0);
  expect(read(".verid/plan.md")).toBe(originalPlan);
  expect(existsSync(join(project, ".verid/artifacts"))).toBe(false);
  expect((await cli("upgrade", "--yes")).code).toBe(0);
  expect(parse(read(".verid/manifest.yaml"))).not.toHaveProperty("workflow");
  expect(read(".verid/.state/state.json")).toBe(evidence);
  const parsed = parsePlan(read(".verid/plan.md"));
  expect(parsed.ok && parsed.modules[0]?.text).toBe(first);
  for (const input of MODULE_INPUTS)
    expect(existsSync(join(project, `.verid/artifacts/03-modules/pending/${input}`))).toBe(true);
  expect(read(".verid/artifacts/03-modules/pending/spec/spec.md")).toBe(
    "Custom pending contract\n",
  );
  expect((await cli("menu")).stdout).toContain("served · done");
  expect((await cli("doctor")).stdout).toContain("Module pending dossier is not ready");
  const again = await planCook(project, { src: [], tests: [], upgrade: true }, true);
  expect(again.files.filter((file) => file.action !== "kept")).toEqual([]);
  for (const input of MODULE_INPUTS)
    put(`.verid/artifacts/03-modules/pending/${input}`, `Agreed pending ${input}\n`);
  expect((await cli("order", "pending")).code).toBe(0);
  await startTaskSession(project, "upgraded-session", "codex");
  await changed("upgraded-session", "test/pending.test.ts");
  scenario(1, "vitest-add-assert.xml");
  expect((await cli("taste")).code).toBe(1);
  await changed("upgraded-session", "src/pending.ts");
  scenario(0, "vitest-ac2-unit.xml");
  expect((await cli("taste")).code).toBe(0);
  await review("upgraded-session", "upgraded-review");
  expect((await cli("serve", "pending")).code).toBe(0);
  expect(state().modules.pending?.served_at).toEqual(expect.any(String));
  expect(parsePlan(read(".verid/plan.md"))).toMatchObject({
    ok: true,
    modules: [{ text: first }, { name: "pending" }],
  });
  put(".verid/plan.md", read(".verid/plan.md").replace("AC-1: done", "AC-1: changed"));
  expect(readPlan(project, false, true, servedSections(state()))).toMatchObject({
    ok: false,
    detail: expect.stringContaining("served: requires Artifacts"),
  });
});

it.each(["quick", "fix"])(
  "the %s path keeps every gate: one AC, a short dossier, then order, TDD, review and serve",
  async (path) => {
    await cook();
    const base = ".verid/artifacts/03-modules/tweak";
    const module = await cli("module", "tweak", `--${path}`);
    expect(module.code, module.stderr).toBe(0);
    expect(read(`${base}/ba/requirements.md`)).toMatch(new RegExp(`^Path: ${path}$`, "m"));
    if (path === "fix") expect(module.stdout).toContain("debugging");
    const lines = MODULE_INPUTS.map((input) => read(`${base}/${input}`).split("\n").length);
    expect(lines.reduce((sum, n) => sum + n, 0)).toBeLessThan(40);

    const plan = (acs: string) =>
      put(".verid/plan.md", `## Module: tweak\nArtifacts: ${base}\n${acs}`);
    plan("- AC-1: adds two numbers (REQ-1)\n");
    expect((await cli("order", "tweak")).code).toBe(2);
    for (const input of MODULE_INPUTS)
      put(
        `${base}/${input}`,
        read(`${base}/${input}`).replace(/\[NEEDS CLARIFICATION[^\]]*\]/g, "Agreed"),
      );
    if (path === "fix") {
      const filled = read(`${base}/ba/requirements.md`);
      put(`${base}/ba/requirements.md`, filled.replace(/(## Root cause\n)[^#]*/, "$1\n"));
      const empty = await cli("order", "tweak");
      expect(empty.code).toBe(2);
      expect(empty.stderr).toContain("Root cause");
      put(`${base}/ba/requirements.md`, filled);
    }
    plan("- AC-1: adds two numbers (REQ-1)\n- AC-2: subtracts (REQ-2)\n");
    const two = await cli("order", "tweak");
    expect(two.code).toBe(2);
    expect(two.stderr).toContain("one AC");
    expect(two.stderr).toContain("verid module tweak");

    plan("- AC-1: adds two numbers (REQ-1)\n");
    const ordered = await cli("order", "tweak");
    expect(ordered.code, ordered.stderr).toBe(0);
    await startTaskSession(project, `${path}-session`, "codex");
    await changed(`${path}-session`, "test/tweak.test.ts");
    scenario(1, "vitest-add-assert.xml");
    expect((await cli("taste")).code).toBe(1);
    await changed(`${path}-session`, "src/tweak.ts");
    scenario(0, "vitest-ac.xml");
    expect((await cli("taste")).code).toBe(0);
    await review(`${path}-session`, `review-${path}`);
    expect((await cli("serve", "tweak")).code).toBe(0);
    expect(state().modules.tweak?.served_at).toEqual(expect.any(String));
  },
);
