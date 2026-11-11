import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { tempProject, manifest, FRESH_STATE } from "../support/project.js";
import * as pluginProcess from "../../src/adapters/plugin-process.js";
import { boardSnapshot } from "../../src/adapters/kanban.js";
import { readPlan } from "../../src/adapters/plan-file.js";
import { signParity } from "../../src/adapters/reheat.js";
import { startBoard } from "../../src/cli/board.js";

const sample = resolve("examples/adapters/sample");
const dossier = ".verid/artifacts/03-modules/calc";
const parityFile = `${dossier}/release/parity.md`;
const parity = "# Parity\n\n## Inputs\n1 + 2\n\n## Legacy results\n3\n\n## New results\n3\n";
const spec = "Behaviour: 1 + 2 -> 3\n";
// Codex tool-call envelope fields the hook's payload schema requires.
const codexTool = {
  transcript_path: null,
  model: "test",
  permission_mode: "default",
  turn_id: "turn-1",
  tool_use_id: "call-1",
};

const t = tempProject("verid-reheat-", {
  state: FRESH_STATE,
  manifest: () =>
    manifest("src/**", undefined, ".", "prep", ["roles:", '  reviewer: ["verid:reviewer"]']),
  review: true,
  taskSession: true,
  setup: (p) => {
    p.put(".verid/research.md", "# Research\n");
    p.put(".verid/design.md", "# Design\nPure functions\n");
    p.put(".verid/spec.md", "- REQ-1: adds two numbers\n");
    p.putPlan(".verid/plan.md", "## Module: calc\n- AC-1: adds two numbers\n");
    p.put(
      "legacy/calc/screen.json",
      JSON.stringify({ title: "Calculator", behaviors: [{ input: "1 + 2", result: "3" }] }),
    );
    p.put("app/src/add.ts", "export {};\n");
    p.editManifest((m) => {
      m.mode = "reheat";
      m.repos[0].path = "app";
      m.repos.push({
        path: "legacy",
        role: "legacy",
        read_only: true,
        source_globs: ["**"],
        test_globs: ["**/*.test.*"],
      });
    });
  },
});
/** The board as the developer's browser uses it, running the same commands as the terminal. */
async function withBoard<T>(work: (post: (body: unknown) => Promise<Response>) => Promise<T>) {
  const board = await startBoard(t.dir, async (command, task, paritySigned) => {
    const run = await t.cli(
      command,
      ...(task ? [task] : []),
      ...(paritySigned ? ["--parity-signed"] : []),
    );
    return { exit: run.code, stdout: run.stdout, stderr: run.stderr };
  });
  const headers = {
    Authorization: `Bearer ${board.token}`,
    "Content-Type": "application/json",
    Origin: board.origin,
  };
  try {
    return await work((body) =>
      fetch(`${board.origin}/api/action`, { method: "POST", headers, body: JSON.stringify(body) }),
    );
  } finally {
    board.server.closeAllConnections();
    await new Promise<void>((resolve) => board.server.close(() => resolve()));
  }
}
const install = (source = sample) => t.cli("plugin", "add", `file:${source}`, "--yes");
const gate = () => t.cli("reheat", "gate", "calc");
/** The adapter ran, the spec names the legacy input and the gate passed: a unit ready to order. */
const gated = async () => {
  expect((await install()).code).toBe(0);
  expect((await t.cli("reheat", "inventory")).code).toBe(0);
  expect((await t.cli("reheat", "extract", "calc")).code).toBe(0);
  t.put(`${dossier}/spec/spec.md`, spec);
  expect((await gate()).code).toBe(3);
};
const red = () =>
  t.put("app/scenario.json", JSON.stringify({ exit: 1, junit: "vitest-red-assert.xml" }));
const green = () => t.put("app/scenario.json", JSON.stringify({ exit: 0, junit: "vitest-ac.xml" }));
const reviewed = async () => {
  red();
  expect((await t.cli("taste")).code).toBe(1);
  green();
  expect((await t.cli("taste")).code).toBe(0);
  t.put(".verid/review/calc.md", "# Review\nVerdict: PASS\n");
  expect((await t.reviewStop("verid:reviewer")("LGTM\nVerdict: pass")).code).toBe(0);
};

it.each([
  ["Write", "legacy/calc/screen.json"],
  ["Edit", "legacy/calc/screen.json"],
  ["a redirect", "legacy/calc/screen.json"],
  ["sed -i", "legacy/calc/screen.json"],
  ["rm", "legacy/calc/screen.json"],
  ["git commit through -C", ""],
  ["git commit after cd", ""],
  ["git commit from inside", ""],
])("blocks a legacy write through %s, whatever the developer says next", async (kind, rel) => {
  const file = t.path(rel);
  const bash = (command: string, cwd?: string) =>
    t.fixture("pre-tool-use-bash", (p) => {
      p.tool_input.command = command;
      if (cwd) p.cwd = cwd;
    });
  const input =
    kind === "Write"
      ? t.fixture("pre-tool-use-write", (p) => (p.tool_input.file_path = file))
      : kind === "Edit"
        ? t.fixture("pre-tool-use-edit", (p) => (p.tool_input.file_path = file))
        : kind === "a redirect"
          ? bash(`echo bad > ${rel}`)
          : kind === "sed -i"
            ? bash(`sed -i 's/a/b/' ${rel}`)
            : kind === "rm"
              ? bash(`rm ${rel}`)
              : kind === "git commit through -C"
                ? bash('git -C legacy commit -m "change"')
                : kind === "git commit after cd"
                  ? bash('cd legacy && git commit -m "change"')
                  : bash('git commit -m "change"', t.path("legacy"));
  const denied = await t.hook(input);
  expect(denied.code).toBe(2);
  expect(denied.stderr).toContain("VERID_BURNT_LEGACY_READ_ONLY");
  const tip = await t.hook(
    t.fixture("user-prompt-submit-verid-tip", (p) => {
      p.prompt = "/verid tip reviewed";
    }),
    { CLAUDE_CODE_SESSION_ATTENDED: "1" },
  );
  expect(tip.stderr).toContain("VERID_BURNT_OVERRIDE_FORBIDDEN");
  // Nothing was written, and the call is refused again, with the same code.
  expect(readFileSync(t.path("legacy/calc/screen.json"), "utf8")).toContain("Calculator");
  expect((await t.hook(input)).stderr).toContain("VERID_BURNT_LEGACY_READ_ONLY");
});

it("blocks a legacy write through apply_patch and a Codex shell, and lets reading and Git status through", async () => {
  const call = (tool_name: string, tool_input: Record<string, unknown>) =>
    t.sessionEvent("PreToolUse", "codex-session", { ...codexTool, tool_name, tool_input });
  for (const result of [
    await call("apply_patch", {
      command:
        "*** Begin Patch\n*** Update File: legacy/calc/screen.json\n@@\n-a\n+b\n*** End Patch",
    }),
    await call("apply_patch", {
      command: "*** Begin Patch\n*** Add File: legacy/calc/new.json\n+{}\n*** End Patch",
    }),
    await call("Bash", { command: "echo bad > legacy/calc/screen.json" }),
    await call("Bash", { command: 'git -C legacy commit -m "change"' }),
  ])
    expect(result.stdout + result.stderr).toContain("VERID_BURNT_LEGACY_READ_ONLY");
  expect((await t.hook(t.readTool("legacy/calc/screen.json"))).code).toBe(0);
  const status = await t.hook(
    t.fixture("pre-tool-use-bash", (p) => (p.tool_input.command = "git -C legacy status")),
  );
  expect(status.code).toBe(0);
  const app = await t.hook(
    t.fixture("pre-tool-use-bash", (p) => (p.tool_input.command = "ls legacy; git -C app status")),
  );
  expect(app.code).toBe(0);
});

it("runs one unit through inventory, extract, gate, order, TDD, review, signed parity and serve", async () => {
  expect((await install()).code).toBe(0);
  const plan = t.read(".verid/plan.md");
  const inventory = await t.cli("reheat", "inventory");
  expect(inventory.code).toBe(0);
  // The plan already has calc: it stays as written.
  expect(t.read(".verid/plan.md")).toBe(plan);
  expect(t.state().reheat.calc).toMatchObject({ title: "Calculator" });
  expect(t.read(parityFile)).toContain("## Legacy results");
  expect((await t.cli("order", "calc")).stderr).toContain("VERID_BURNT_REHEAT_GATE");

  const extract = await t.cli("reheat", "extract", "calc");
  expect(extract.code).toBe(0);
  expect(extract.stdout).toContain("screens-spec");
  expect(t.read(`${dossier}/spec/legacy/screen.json`)).toContain("Calculator");
  // The spec does not name the legacy input yet.
  const failed = await gate();
  expect(failed.code).toBe(1);
  expect(failed.stdout).toContain("behaviour-covered");
  t.put(`${dossier}/spec/spec.md`, spec);
  expect((await gate()).code).toBe(3);

  expect((await t.cli("order", "calc")).code).toBe(0);
  await reviewed();
  expect((await t.cli("serve", "calc")).stderr).toContain("VERID_BURNT_PARITY");
  t.put(parityFile, parity);
  const unsigned = await t.cli("serve", "calc");
  expect(unsigned.code).toBe(2);
  expect(unsigned.stderr).toContain("VERID_BURNT_PARITY");
  expect(t.state().modules.calc.served_at).toBeNull();
  expect((await t.cli("serve", "calc", "--parity-signed")).code).toBe(0);
  expect(t.state().modules.calc.served_at).toBeTruthy();
  expect(t.state().reheat.calc.parity.sha256).toBe(
    createHash("sha256")
      .update(readFileSync(t.path(parityFile)))
      .digest("hex"),
  );
  expect((await gate()).code).toBe(0);
});

it.each([
  { exit: 7, timedOut: false, stdout: "", stderr: "failed" },
  { exit: 0, timedOut: false, stdout: "{}", stderr: "" },
  { exit: 0, timedOut: false, stdout: "not json", stderr: "" },
  { exit: null, timedOut: true, stdout: "", stderr: "" },
])("changes no state when an adapter fails: %j", async (result) => {
  expect((await install()).code).toBe(0);
  expect((await t.cli("reheat", "inventory")).code).toBe(0);
  expect((await t.cli("reheat", "extract", "calc")).code).toBe(0);
  t.put(`${dossier}/spec/spec.md`, spec);
  const before = [".verid/.state/state.json", ".verid/.state/audit.jsonl", ".verid/plan.md"].map(
    (file) => t.read(file),
  );
  const spy = vi.spyOn(pluginProcess, "runPluginCommand").mockResolvedValue(result);
  try {
    for (const args of [["inventory"], ["extract", "calc"], ["gate", "calc"]]) {
      const run = await t.cli("reheat", ...args);
      expect(run.code, args.join(" ")).toBe(1);
      expect(run.stderr).toContain("VERID_BURNT_ADAPTER");
    }
  } finally {
    spy.mockRestore();
  }
  expect(
    [".verid/.state/state.json", ".verid/.state/audit.jsonl", ".verid/plan.md"].map((file) =>
      t.read(file),
    ),
  ).toEqual(before);
});

it("reports an adapter that is missing, changed or doubled as an adapter error", async () => {
  expect((await t.cli("reheat", "inventory")).stderr).toContain("VERID_BURNT_ADAPTER");
  expect((await install()).code).toBe(0);
  const second = t.newDir("verid-adapter-second-");
  cpSync(sample, second, { recursive: true });
  const file = join(second, "verid-plugin.json");
  writeFileSync(file, readFileSync(file, "utf8").replace('"screens"', '"screens-two"'));
  expect((await install(second)).code).toBe(0);
  const run = await t.cli("reheat", "inventory");
  expect(run.code).toBe(1);
  expect(run.stderr).toContain("VERID_BURNT_ADAPTER");
});

it("cancels the order after a failing gate and asks for a current gate after any input edit", async () => {
  await gated();
  expect((await t.cli("order", "calc")).code).toBe(0);
  expect(t.state().kanban.active.module).toBe("calc");
  const spy = vi.spyOn(pluginProcess, "runPluginCommand").mockResolvedValue({
    exit: 0,
    timedOut: false,
    stdout: JSON.stringify({ unit: "calc", pass: false, findings: [] }),
    stderr: "",
  });
  try {
    expect((await gate()).code).toBe(1);
  } finally {
    spy.mockRestore();
  }
  expect(t.state().modules.calc).toBeUndefined();
  expect(t.state().kanban.active).toBeNull();
  expect((await t.cli("order", "calc")).stderr).toContain("VERID_BURNT_REHEAT_GATE");
  expect((await gate()).code).toBe(3);
  expect((await t.cli("order", "calc")).code).toBe(0);
  // A change to the spec, or to what was extracted, makes the earlier pass stale.
  expect((await t.cli("reheat", "inventory")).code).toBe(0);
  t.put(`${dossier}/spec/spec.md`, `${spec}Another line\n`);
  expect(t.read(".verid/.state/state.json")).toContain('"pass": true');
  expect((await t.cli("serve", "calc")).stderr).toMatch(/VERID_BURNT_(REHEAT_GATE|TASK_SESSION)/);
  expect((await gate()).code).toBe(3);
  t.put(`${dossier}/spec/legacy/extra.json`, "{}");
  const changed = await gate();
  expect(changed.code).toBe(2);
  expect(changed.stderr).toContain("VERID_BURNT_REHEAT_GATE");
});

it("adds fifty draft units to the plan, keeps what the plan had, and adds nothing when run again", async () => {
  const source = t.newDir("verid-adapter-source-");
  cpSync(sample, source, { recursive: true });
  const file = join(source, "verid-plugin.json");
  const plugin = JSON.parse(readFileSync(file, "utf8"));
  plugin.adapter.commands.inventory = `node -e 'console.log(JSON.stringify({units:Array.from({length:50},(_,i)=>({id:"screen-"+i,title:"Screen "+i}))}))'`;
  writeFileSync(file, JSON.stringify(plugin));
  expect((await install(source)).code).toBe(0);
  const before = t.read(".verid/plan.md");
  expect((await t.cli("reheat", "inventory")).code).toBe(0);
  const after = t.read(".verid/plan.md");
  expect(after.startsWith(before)).toBe(true);
  expect(after.match(/^## Module: screen-/gm) ?? []).toHaveLength(50);
  expect(after).toContain("Artifacts: .verid/artifacts/03-modules/screen-49");
  // The plan reads strictly: every unit has a dossier of placeholders.
  const read = readPlan(t.dir, false, true);
  expect(read?.ok && read.modules.length).toBe(51);
  expect((await t.cli("reheat", "inventory")).code).toBe(0);
  expect(t.read(".verid/plan.md")).toBe(after);
  const menu = (await t.cli("menu")).stdout;
  expect(menu).toContain("screen-0 · planned");
  expect(menu).toContain("extract no · gate none · parity none");
});

it("keeps a plan it cannot add to unchanged", async () => {
  expect((await install()).code).toBe(0);
  t.put(".verid/plan.md", "- AC-1: a plan with no module heading\n");
  const before = t.read(".verid/plan.md");
  const run = await t.cli("reheat", "inventory");
  expect(run.code).toBe(2);
  expect(run.stderr).toContain("VERID_BURNT_PLAN_INVALID");
  expect(t.read(".verid/plan.md")).toBe(before);
});

it("rejects reheat commands outside mode reheat and unknown arguments", async () => {
  expect((await t.cli("reheat")).code).toBe(2);
  expect((await t.cli("reheat", "extract")).code).toBe(2);
  expect((await t.cli("reheat", "gate", "calc", "more")).code).toBe(2);
  t.editManifest((m) => {
    m.mode = "prep";
    m.repos = [m.repos[0]];
  });
  expect((await t.cli("reheat", "inventory")).stderr).toContain("VERID_BURNT_MODE_MISMATCH");
  expect((await t.cli("reheat", "extract", "../escape")).code).toBe(2);
});

it("refuses unknown units without touching state", async () => {
  expect((await install()).code).toBe(0);
  expect((await t.cli("reheat", "inventory")).code).toBe(0);
  const before = t.read(".verid/.state/state.json");
  for (const unit of ["missing", "constructor", "../escape"]) {
    const run = await t.cli("reheat", "extract", unit);
    expect(run.stderr, unit).toContain("VERID_BURNT_MODULE_UNKNOWN");
  }
  expect(t.read(".verid/.state/state.json")).toBe(before);
});

it("signs parity only for the developer, binds the signature to the evidence and shows unit progress", async () => {
  await gated();
  t.put(parityFile, parity);
  const agent = await t.cliWith({ CLAUDECODE: "1" }, "serve", "calc", "--parity-signed");
  expect(agent.stderr).toContain("VERID_BURNT_SERVE_IN_AGENT");
  expect(t.state().reheat.calc.parity).toBeUndefined();
  // A big-brain board cannot sign: that happens in the terminal, at serve.
  await withBoard(async (post) => {
    const snapshot = await boardSnapshot(t.dir);
    const refused = await post({ action: "parity", task: "calc", revision: snapshot.revision });
    expect(refused.status).toBe(409);
  });
  expect(t.state().reheat.calc.parity).toBeUndefined();
  signParity(t.dir, "calc");
  expect((await gate()).code).toBe(0);
  const task = (await boardSnapshot(t.dir)).tasks.find((item) => item.id === "calc");
  expect(task?.migration).toMatchObject({ gate: "pass", parity: true, canSignParity: false });
  // Any edit voids the signature.
  t.put(parityFile, `${parity}One more case\n`);
  expect((await gate()).code).toBe(3);
  expect(
    (await boardSnapshot(t.dir)).tasks.find((item) => item.id === "calc")?.migration,
  ).toMatchObject({ parity: false, parityState: "unsigned" });
  // An incomplete record cannot be signed at all.
  t.put(parityFile, "# Parity\n\n## Inputs\n1 + 2\n");
  expect(() => signParity(t.dir, "calc")).toThrow(/parity/i);
  const menu = (await t.cli("menu")).stdout;
  expect(menu).toContain("calc ·");
  expect(menu).toContain("gate pass");
});

it("offers the no-brain board a parity signature only for a passing gate and a complete record", async () => {
  await gated();
  t.editManifest((m) => {
    m.drive = "no-brain";
    m.roles = { reviewer: ["verid:reviewer"], tester: ["verid:tester"], coder: ["verid:coder"] };
  });
  const task = async () => (await boardSnapshot(t.dir)).tasks.find((item) => item.id === "calc");
  expect((await task())?.migration?.canSignParity).toBe(false);
  t.put(parityFile, parity);
  expect((await task())?.migration).toMatchObject({ canSignParity: true, parityState: "unsigned" });
  // The one thing the developer does in a drive that serves by itself.
  const agent = await t.cliWith({ CLAUDECODE: "1" }, "serve", "calc", "--parity-signed");
  expect(agent.stderr).toContain("VERID_BURNT_SERVE_IN_AGENT");
  expect((await t.cli("serve", "calc")).stderr).toContain("VERID_BURNT_AUTO_SERVE");
  // The board's button runs the same signature, and only while there is something to sign.
  await withBoard(async (post) => {
    const revision = async () => (await boardSnapshot(t.dir)).revision;
    const unknown = await post({ action: "parity", task: "nothing", revision: await revision() });
    expect(unknown.status).toBe(409);
    expect(t.state().reheat.calc.parity).toBeUndefined();
    const signed = await post({ action: "parity", task: "calc", revision: await revision() });
    expect(signed.status).toBe(200);
    expect(t.state().reheat.calc.parity.sha256).toBeTruthy();
    const again = await post({ action: "parity", task: "calc", revision: await revision() });
    expect(again.status).toBe(409);
  });
  // Signing serves nothing: the drive closes the unit once tests and review pass.
  expect(t.state().modules.calc?.served_at ?? null).toBeNull();
  expect((await task())?.migration).toMatchObject({ canSignParity: false, parity: true });
  const cli = await t.cli("serve", "calc", "--parity-signed");
  expect(cli.code).toBe(0);
});

it("leaves the legacy repo out of test runs and tells doctor what is wrong", async () => {
  await gated();
  expect((await t.cli("order", "calc")).code).toBe(0);
  await reviewed();
  // No test_cmd on the legacy repo and no runner there: the run still counts.
  expect(existsSync(t.path("legacy/calc/screen.json"))).toBe(true);
  expect((await t.cli("doctor")).stdout).not.toContain("repo.runner");
  t.editManifest((m) => delete m.repos[1].read_only);
  const doctor = await t.cli("doctor");
  expect(doctor.code).toBe(1);
  expect(doctor.stdout).toContain("read_only");
  expect(doctor.stdout).toContain("read_only: true on every repo with role legacy");
});

it("tells doctor that a reheat project has no adapter", async () => {
  const doctor = await t.cli("doctor");
  expect(doctor.stdout).toContain("no enabled plugin declares an adapter");
  expect((await install()).code).toBe(0);
  expect((await t.cli("doctor")).stdout).not.toContain("no enabled plugin declares an adapter");
});

it("leaves a prep project with its own rules even when it has a folder named legacy", async () => {
  t.editManifest((m) => {
    m.mode = "prep";
    m.repos = [m.repos[0]];
  });
  const write = await t.hook(
    t.fixture(
      "pre-tool-use-write",
      (p) => (p.tool_input.file_path = t.path("legacy/calc/new.json")),
    ),
  );
  expect(write.stderr).not.toContain("VERID_BURNT_LEGACY_READ_ONLY");
});
