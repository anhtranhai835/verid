import { tempProject } from "../support/project.js";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";

import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { autoPhase } from "../../src/core/auto.js";
import { parsePlan } from "../../src/core/plan.js";
import { defaultRoles } from "../../src/core/manifest.js";
import {
  autoFactsOf,
  MODULE_INPUTS,
  readPlan,
  servedSections,
} from "../../src/adapters/plan-file.js";
import { statePaths, writeState } from "../../src/adapters/state-store.js";
import { planCook } from "../../src/cli/init.js";
import { readyModulePlan, startTaskSession } from "./helpers.js";
import { runReview } from "./in-process.js";

let fixture: string;
let project: string;

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
    vi.unstubAllEnvs();
  },
});
const { read, put, loadState: state, cliBound: cli, sessionEvent: hook, payloadFor: payload } = t;
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
async function createModules() {
  put(
    ".verid/plan.md",
    "## Module: req-1\nArtifacts: .verid/artifacts/03-modules/req-1\n- AC-1: Add two numbers (REQ-1)\n\n## Module: req-2\nArtifacts: .verid/artifacts/03-modules/req-2\n- AC-2: Subtract two numbers (REQ-2)\n\n## Module: product\nArtifacts: .verid/artifacts/03-modules/product\nDepends: req-1, req-2\n- AC-3 (e2e): Verify the complete product (REQ-1, REQ-2)\n",
  );
  for (const name of ["req-1", "req-2", "product"])
    expect((await cli("module", name)).code).toBe(0);
}
async function splitReady() {
  await createModules();
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

it("module scaffolding creates real unfinished dossiers that block order", async () => {
  await cook();
  await createModules();
  for (const name of ["req-1", "req-2", "product"]) {
    expect(read(".verid/plan.md")).toContain(`Artifacts: .verid/artifacts/03-modules/${name}`);
    expect(
      existsSync(join(project, `.verid/artifacts/03-modules/${name}/ba/requirements.md`)),
    ).toBe(true);
  }
  const peek = (await cli("peek")).stdout;
  expect(peek).toContain("Next: finish .verid/artifacts/03-modules/req-1/");
  expect(peek).not.toContain("fix .verid/plan.md");
  expect((await cli("order", "req-1")).code).toBe(2);
});

it("remix leaves baseline gates unchanged", async () => {
  await cook("human", "monorepo", "remix");
  expect(existsSync(join(project, ".verid/artifacts"))).toBe(false);
});

it("AC-8: both drives block unfinished dossiers, missing inputs and missing Artifacts from module work", async () => {
  for (const drive of ["human", "ai"] as const) {
    t.fresh();
    await cook(drive);
    await createModules();
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
  }
});

it("AC-13: SessionStart describes module dossiers, module order and the session rule for each drive", async () => {
  for (const drive of ["human", "ai"] as const) {
    t.fresh();
    await cook(drive);
    await splitReady();
    expect((await (drive === "human" ? cli("order", "req-1") : cli("order"))).code).toBe(0);
    const startup = await hook("SessionStart", "instruction-session", { source: "startup" });
    expect(startup.code, startup.stderr).toBe(0);
    const context = JSON.parse(startup.stdout).hookSpecificOutput.additionalContext;
    expect(context).toContain("module dossiers in .verid/artifacts/03-modules/<name>");
    expect(context).toContain("required before order");
    expect(context).toContain("verid menu shows module order");
    if (drive === "human") {
      expect(context).toContain("ONE TASK PER SESSION");
      expect(context).toContain("Never start another task in this session");
    } else {
      expect(context).toContain(
        "AI drive follows the module order in .verid/plan.md in one session",
      );
      expect(context).toContain("Finish the current task before moving to the next");
      expect(context).not.toContain("ONE TASK PER SESSION");
    }
  }
});

it("denies agent writes to protected task state", async () => {
  await cook();
  await splitReady();
  expect((await cli("order", "req-1")).code).toBe(0);
  await startTaskSession(project, "owner", "codex");
  const result = await hook("PreToolUse", "owner", {
    tool_name: "apply_patch",
    tool_input: {
      command:
        "*** Begin Patch\n*** Update File: .verid/.state/state.json\n@@\n-a\n+b\n*** End Patch",
    },
  });
  expect(result.stdout).toContain("VERID_BURNT_STATE_PROTECTED");
});

it("AC-16, AC-25, AC-26: AI follows plan order, ignores legacy queue state and refuses manual selection", async () => {
  await cook("ai");
  await splitReady();
  const legacy = state();
  writeState(statePaths(project), {
    ...legacy,
    kanban: { ...legacy.kanban, queue: ["req-2", "req-1"] },
  });
  expect((await cli("order")).code).toBe(0);
  await startTaskSession(project, "ai", "codex");
  await review("ai", "plan-review");
  let facts = autoFactsOf(project, state(), false, true);
  expect(autoPhase(facts)).toMatchObject({ kind: "module", view: { name: "req-1" } });
  const planHash = facts.planHash;
  const original = state();
  writeState(statePaths(project), {
    ...original,
    kanban: { ...original.kanban, queue: ["product", "unknown", "req-2"] },
  });
  facts = autoFactsOf(project, state(), false, true);
  expect(facts.planHash).toBe(planHash);
  expect(autoPhase(facts)).toMatchObject({ kind: "module", view: { name: "req-1" } });
  const refused = await cli("order", "req-1");
  expect(refused.code).toBe(2);
});

it("AC-9, AC-10, AC-31: both drives complete two modules in each layout through real order/TDD/review/serve gates", async () => {
  for (const [drive, layout] of [
    ["human", "monorepo"],
    ["ai", "monorepo"],
    ["human", "workspace"],
    ["ai", "workspace"],
  ] as const) {
    t.fresh();
    await cook(drive, layout);
    await splitReady();
    if (drive === "ai") {
      expect((await cli("order")).code).toBe(0);
      await startTaskSession(project, "ai-session", "codex");
      await review("ai-session", "plan");
    }
    for (const [task, ac] of [
      ["req-1", 1],
      ["req-2", 2],
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
    }
    expect((await cli("menu")).stdout).toContain("product");
  }
});

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
  const doctor = (await cli("doctor")).stdout;
  expect(doctor).toContain("Module pending dossier is not ready");
  // The fix names the dossier to finish; upgrading verid has nothing to do with a draft.
  const finding = doctor.split("\n").find((l) => l.includes("Module pending dossier"));
  expect(finding).toContain(".verid/artifacts/03-modules/pending/");
  expect(finding).not.toContain("upgrade");
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

it("the quick and fix paths keep every gate: one AC, a short dossier, then order, TDD, review and serve", async () => {
  for (const path of ["quick", "fix"] as const) {
    t.fresh();
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
  }
});
