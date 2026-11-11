import { describe, expect, it, vi } from "vitest";
import { contextPacket, type ContextInput } from "../../src/core/context-packet.js";
import { parsePlan } from "../../src/core/plan.js";
import { runCli } from "../../src/cli/main.js";
import { taskPrompt } from "../../src/adapters/kanban.js";
import { tempProject, kanbanManifest } from "../support/project.js";

const SPEC = [
  "# Spec",
  "- REQ-1: Valid credentials open the workspace",
  "- REQ-2: Locked accounts are refused",
  "- SEC-1: Errors never reveal which field was wrong",
  "- REQ-3: Unrelated export feature",
].join("\n");

const PLAN = [
  "## Module: sign-in",
  "Title: Sign in with email and password",
  "Depends: user-storage",
  "- AC-1: Valid credentials open the member workspace (REQ-1)",
  "- AC-2: Invalid credentials return the agreed generic error (REQ-1, SEC-1)",
  "Artifacts: .verid/artifacts/03-modules/sign-in",
  "",
].join("\n");

function input(over: Partial<ContextInput> = {}): ContextInput {
  const parsed = parsePlan(PLAN);
  if (!parsed.ok) throw new Error(parsed.detail);
  return {
    module: parsed.modules[0]!,
    plan: { path: ".verid/plan.md", sha: "3f2a1b9c0000" },
    spec: { path: ".verid/spec.md", text: SPEC, sha: "9c1d00000000" },
    design: { path: ".verid/design.md", sha: "77b000000000" },
    needs: [{ name: "user-storage", phase: "done" }],
    files: [
      { path: "ba/requirements.md", state: "ok" },
      { path: "ui/brief.md", state: "empty" },
    ],
    dossier: ".verid/artifacts/03-modules/sign-in",
    run: "verid taste",
    log: { path: ".verid/log/sign-in.md", last: "AC-1 green" },
    ...over,
  };
}

describe("context packet", () => {
  it("quotes only the spec lines the module's ACs cite, with sources and hashes", () => {
    const text = contextPacket(input());
    expect(text).toContain("sign-in · Sign in with email and password");
    expect(text).toContain("AC-1");
    expect(text).toContain("REQ-1  Valid credentials open the workspace");
    expect(text).toContain("SEC-1");
    expect(text).not.toContain("REQ-2");
    expect(text).not.toContain("REQ-3");
    expect(text).toContain(".verid/plan.md#module-sign-in");
    expect(text).toContain("3f2a1b9c");
    expect(text).toContain("9c1d0000");
    expect(text).toContain("77b00000");
    expect(text).toContain("needs  user-storage: done");
    expect(text).toContain("ui/brief.md empty");
    expect(text).toContain("log    .verid/log/sign-in.md · last: AC-1 green");
  });

  it("with an AC code prints that AC and its requirements only", () => {
    const text = contextPacket(input({ ac: "AC-1" }));
    expect(text).toContain("AC-1");
    expect(text).not.toContain("AC-2");
    expect(text).not.toContain("SEC-1");
    expect(text).toContain("REQ-1");
    expect(contextPacket(input({ ac: "AC-9" }))).toContain("AC-9 not in module sign-in");
  });

  it("reports a cited requirement the spec does not have", () => {
    const text = contextPacket(
      input({ spec: { path: ".verid/spec.md", text: "- REQ-1: only this\n", sha: "00" } }),
    );
    expect(text).toContain("SEC-1 missing in .verid/spec.md");
    expect(contextPacket(input({ spec: null }))).toContain("spec   missing: .verid/spec.md");
    expect(contextPacket(input({ design: null }))).toContain("design missing: .verid/design.md");
  });

  it("stays under 4000 characters for a 200 module plan and a 100000 character spec", () => {
    const spec = Array.from({ length: 2000 }, (_, i) => `- REQ-${i + 1}: ${"x".repeat(40)}`).join(
      "\n",
    );
    const sections = Array.from({ length: 200 }, (_, i) => `## Module: m${i}\n`).join("");
    const acs = Array.from(
      { length: 150 },
      (_, i) => `- AC-${i + 1}: ${"long ".repeat(60)} (REQ-${i + 1})`,
    ).join("\n");
    const parsed = parsePlan(`${sections}## Module: big\n${acs}\n`);
    if (!parsed.ok) throw new Error(parsed.detail);
    const text = contextPacket(
      input({
        module: parsed.modules.at(-1)!,
        spec: { path: ".verid/spec.md", text: spec, sha: "ab" },
        needs: Array.from({ length: 200 }, (_, i) => ({ name: `m${i}`, phase: "done" })),
      }),
    );
    expect(spec.length).toBeGreaterThan(80000);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain("cut: see .verid/plan.md");
  });

  it("cuts one over-long AC and says where the whole text is", () => {
    const parsed = parsePlan(`## Module: a\n- AC-1: ${"word ".repeat(200)}(REQ-1)\n`);
    if (!parsed.ok) throw new Error(parsed.detail);
    const text = contextPacket(input({ module: parsed.modules[0]! }));
    expect(text).toContain("cut: see .verid/plan.md");
    expect(text.split("\n").find((l) => l.startsWith("AC-1"))!.length).toBeLessThan(300);
  });

  it("changes its hash line when the plan section changes", () => {
    const a = contextPacket(input());
    const b = contextPacket(input({ plan: { path: ".verid/plan.md", sha: "ffee00112233" } }));
    expect(a).not.toBe(b);
    expect(b).toContain("ffee0011");
  });
});

describe("context command and task prompt", () => {
  const p = tempProject("verid-context-", {
    claudeProject: false,
    manifest: kanbanManifest,
    state: { schemaVersion: 1, language: "en" },
    setup: (p) => {
      p.put(".verid/spec.md", "- REQ-1: Add numbers\n- REQ-2: Subtract numbers\n");
      p.put(".verid/design.md", "# Design\n");
      p.putPlan(
        ".verid/plan.md",
        "## Module: add\nTitle: Add\n- AC-1: adds (REQ-1)\n\n## Module: sub\nDepends: add\n- AC-2: subtracts (REQ-2)\n",
      );
      vi.stubEnv("CLAUDE_PROJECT_DIR", p.root);
    },
    teardown: () => {
      vi.unstubAllEnvs();
    },
  });

  it("prints the packet for a named module and changes nothing", async () => {
    const before = [p.read(".verid/.state/state.json")];
    const r = await runCli(["context", "sub"]);
    expect(r.exit, r.stderr).toBe(0);
    expect(r.stdout).toContain("sub");
    expect(r.stdout).toContain("REQ-2");
    expect(r.stdout).not.toContain("REQ-1:");
    expect(r.stdout).toContain("needs  add: planned");
    expect(r.stdout.length).toBeLessThanOrEqual(4000);
    expect([p.read(".verid/.state/state.json")]).toEqual(before);
    expect((await runCli(["context", "sub", "--ac", "AC-2"])).stdout).toContain("AC-2");
  });

  it("fails shortly when no module is open or the module is unknown", async () => {
    const none = await runCli(["context"]);
    expect(none.exit).toBe(2);
    expect(none.stderr.length).toBeLessThan(400);
    expect((await runCli(["context", "nope"])).exit).toBe(2);
    expect((await runCli(["context", "sub", "--bad"])).exit).toBe(2);
  });

  it("points the task prompt at the packet instead of whole documents", async () => {
    p.seed({
      kanban: {
        active: { module: "add", session: null, spec_sha256: "x" },
        sessions: {},
        queue: [],
      },
    });
    const prompt = taskPrompt(p.root, "add");
    expect(prompt).toContain("verid context add");
    expect(prompt).not.toMatch(/\.verid\/spec\.md, \.verid\/design\.md/);
    expect(prompt).toContain("NEW session for task add only");
  });
});
