import { tempProject } from "../support/project.js";
import { startTaskSession } from "./helpers.js";
import { readFileSync } from "node:fs";

import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { runHook } from "./in-process.js";

let project: string;

const t = tempProject("verid-review-freshness-", {
  approved: true,
  manifestPreset: "review",
  parents: false,
  claudeProject: false,
  cwd: () => project,
  bind: (p) => {
    project = p.root;
  },
});
const { state, putPlan: put, cli, manifestForDrive: manifest } = t;
beforeEach(async () => {
  expect((await cli("order", "calc")).code).toBe(0);
  expect((await cli("taste")).code).toBe(0);
  expect((await cli("garnish")).code).toBe(0);
});

const cases = [
  ["claude-code", "reviewer", "verid:reviewer"],
  ["claude-code", "security", "verid:security"],
  ["codex", "reviewer", "verid_reviewer"],
  ["codex", "security", "codex_security"],
] as const;
const call = async (provider: string, event: string, extra = {}) => {
  if (state().kanban.active?.session === null)
    await startTaskSession(project, "review-session", provider);
  return runHook(
    JSON.stringify({
      hook_event_name: event,
      cwd: project,
      session_id: "review-session",
      model: "test",
      transcript_path: null,
      permission_mode: "default",
      turn_id: "turn",
      tool_use_id: "call",
      ...extra,
    }),
    { CLAUDE_PROJECT_DIR: project },
    provider === "codex" ? ["--provider", "codex"] : [],
  );
};
const start = (provider: string, type: string, id = "r1") =>
  call(provider, "SubagentStart", { agent_id: id, agent_type: type });
const stop = (provider: string, type: string, id = "r1") =>
  call(provider, "SubagentStop", {
    agent_id: id,
    agent_type: type,
    stop_hook_active: false,
    ...(provider === "codex" ? { agent_transcript_path: null } : {}),
    last_assistant_message: "AC-1 checked\nVerdict: pass",
  });
const report = (kind: string) => state()[kind === "reviewer" ? "review" : "security"];

it.each(cases)("rejects %s %s reports without a matching start", async (provider, kind, type) => {
  await stop(provider, type);
  expect(report(kind)).toBeNull();
  expect(readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")).toContain(
    "REVIEW_STALE",
  );
});

it.each(cases)(
  "rejects %s %s after a concurrent code write, even after passing taste",
  async (provider, kind, type) => {
    await start(provider, type);
    const result = await call(
      provider,
      "PreToolUse",
      provider === "codex"
        ? {
            tool_name: "apply_patch",
            tool_input: {
              command:
                "*** Begin Patch\n*** Add File: src/add.ts\n+export const add = () => 0;\n*** End Patch",
            },
          }
        : {
            tool_name: "Write",
            tool_input: { file_path: "src/add.ts", content: "export const add = () => 0;" },
          },
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout, result.stdout).toBe("");
    put("src/add.ts", "export const add = () => 0;\n");
    expect((await cli("taste")).code).toBe(0);
    // Duplicate start notifications cannot make an old review current again.
    await start(provider, type);
    await stop(provider, type);
    expect(report(kind)).toBeNull();
    await start(provider, type, "fresh");
    await stop(provider, type, "fresh");
    expect(report(kind)).toMatchObject({ verdict: "pass" });
    expect(report(kind).identity).toMatch(/^[a-f0-9]{64}$/);
    await stop(provider, type, "fresh");
    expect(Object.keys(state().review_jobs)).toHaveLength(0);
  },
);

it.each(cases)("preserves %s %s across taste without writes", async (provider, kind, type) => {
  await start(provider, type);
  expect((await cli("taste")).code).toBe(0);
  await stop(provider, type);
  expect(report(kind)).toMatchObject({ verdict: "pass" });
});

it.each(cases)(
  "invalidates %s %s when the developer reorders the same module",
  async (provider, kind, type) => {
    await start(provider, type);
    expect((await cli("order", "calc")).code).toBe(0);
    await stop(provider, type);
    expect(report(kind)).toBeNull();
  },
);

it.each(cases)("invalidates %s %s when design inputs change", async (provider, kind, type) => {
  await start(provider, type);
  put(".verid/design.md", "# Changed interface\n");
  await stop(provider, type);
  expect(report(kind)).toBeNull();
});

it.each(["claude-code", "codex"])(
  "invalidates only security for a free project write on %s",
  async (provider) => {
    const reviewer = provider === "codex" ? "verid_reviewer" : "verid:reviewer";
    const security = provider === "codex" ? "codex_security" : "verid:security";
    await start(provider, reviewer, "correctness");
    await start(provider, security, "security");
    await call(provider, "PreToolUse", {
      tool_name: "Bash",
      tool_input: { command: "echo updated > README.md" },
    });
    await stop(provider, reviewer, "correctness");
    await stop(provider, security, "security");
    expect(state().review?.verdict).toBe("pass");
    expect(state().security).toBeNull();
  },
);

it("rejects an auto-plan review when the plan changes while it is being read", async () => {
  put(".verid/manifest.yaml", JSON.stringify({ ...manifest("auto"), providers: ["codex"] }));
  const ordered = await cli("order");
  expect(ordered.code, ordered.stderr).toBe(0);
  await start("codex", "verid_reviewer");
  put(
    ".verid/plan.md",
    readFileSync(join(project, ".verid/plan.md"), "utf8") + "\nUpdated constraints\n",
  );
  await stop("codex", "verid_reviewer");
  expect(state().auto.plan_sha256).toBeNull();
  await start("codex", "verid_reviewer", "new-plan");
  await stop("codex", "verid_reviewer", "new-plan");
  expect(state().auto.plan_sha256).toMatch(/^[a-f0-9]{64}$/);
});

it.each(cases)(
  "invalidates %s %s when design inputs change after a compact packet is written",
  async (provider, kind, type) => {
    const packet = await cli("menu", "--commits", "--file", "--compact");
    expect(packet.code, packet.stderr).toBe(0);
    await start(provider, type);
    put(".verid/design.md", "# Changed after the packet\n");
    await stop(provider, type);
    expect(report(kind)).toBeNull();
  },
);
