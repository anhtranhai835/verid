import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { tempProject, manifest, FRESH_STATE } from "../support/project.js";
import { pluginCommand } from "../../src/cli/plugin.js";
import { emitPluginEvent, runPluginCommand } from "../../src/adapters/plugin-hooks.js";
import { readPlugins } from "../../src/adapters/plugin-store.js";
import { verifyAuditChain } from "../../src/adapters/audit-log.js";
import { loadManifest } from "../../src/adapters/manifest.js";
import { writerOf } from "../../src/core/roles.js";
import * as pluginProcess from "../../src/adapters/plugin-process.js";
import { withPluginDispatch } from "../../src/adapters/plugin-store.js";
import { decideDispatch } from "../../src/core/dispatch.js";

const t = tempProject("verid-plugin-", {
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
  },
});
const sample = resolve("examples/plugins/sample");
const registry = () => JSON.parse(t.read(".verid/plugins.json"));
const installed = () => join(t.dir, ".verid/.plugins/sample");
const add = (source = `file:${sample}`) => t.cli("plugin", "add", source, "--yes");
const custom = (changes: Record<string, unknown> = {}) => {
  const source = t.newDir("verid-plugin-source-");
  cpSync(sample, source, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(source, "verid-plugin.json"), "utf8"));
  writeFileSync(join(source, "verid-plugin.json"), JSON.stringify({ ...manifest, ...changes }));
  return source;
};

it.each([
  ".verid/plugins.json",
  ".verid/.plugins/sample/hook.mjs",
  ".verid/.plugin-data/sample/log.jsonl",
  ".VERID/.PLUGINS/sample/code.js",
])("blocks file, patch, MCP and shell writes to %s", async (path) => {
  const calls = [
    { tool_name: "Write", tool_input: { file_path: t.path(path), content: "evil" } },
    {
      tool_name: "apply_patch",
      tool_input: { command: `*** Begin Patch\n*** Add File: ${path}\n+evil\n*** End Patch` },
    },
    { tool_name: "mcp__files__write_file", tool_input: { path: t.path(path), content: "evil" } },
    { tool_name: "Bash", tool_input: { command: `echo evil > ${path}` } },
  ];
  for (const call of calls) {
    const result = await t.sessionEvent("PreToolUse", "planning", call);
    expect(result.stderr + result.stdout).toContain("VERID_BURNT_PLUGIN_PROTECTED");
  }
});

it.each(["add file:sample", "remove sample", "list", "doctor"])(
  "blocks plugin %s in an agent shell and through the hook",
  async (args) => {
    expect((await t.cliWith({ CLAUDECODE: "1" }, "plugin", ...args.split(" "))).stderr).toContain(
      "VERID_BURNT_PLUGIN_IN_AGENT",
    );
    const result = await t.sessionEvent("PreToolUse", "planning", {
      tool_name: "Bash",
      tool_input: { command: `node .verid/verid.mjs plugin ${args}` },
    });
    expect(result.stdout + result.stderr).toContain("VERID_BURNT_PLUGIN_PROTECTED");
  },
);

it("keeps plugin writes non-overridable", async () => {
  await t.hook(t.write(".verid/plugins.json"));
  const result = await t.hook(
    t.fixture("user-prompt-submit-verid-tip", (p) => {
      p.prompt = "/verid tip reviewed";
    }),
    { CLAUDE_CODE_SESSION_ATTENDED: "1" },
  );
  expect(result.stderr).toContain("VERID_BURNT_OVERRIDE_FORBIDDEN");
});

it("installs the sample and delivers all workflow events after the main decisions", async () => {
  expect((await add()).code).toBe(0);
  expect((await t.cli("order", "calc")).code).toBe(0);
  t.put("scenario.json", JSON.stringify({ exit: 1, junit: "vitest-red-assert.xml" }));
  expect((await t.cli("taste")).code).toBe(1);
  t.put("scenario.json", JSON.stringify({ exit: 0, junit: "vitest-ac.xml" }));
  expect((await t.cli("taste")).code).toBe(0);
  t.put(".verid/review/calc.md", "# Review\nVerdict: PASS\n");
  expect((await t.reviewStop("verid:reviewer")("LGTM\nVerdict: pass")).code).toBe(0);
  expect((await t.cli("serve", "calc")).code).toBe(0);
  const events = t
    .read(".verid/.plugin-data/sample/events.jsonl")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.map((e) => e.event)).toEqual([
    "after-order",
    "on-state",
    "on-state",
    "after-serve",
  ]);
  expect(events[0]).toMatchObject({ module: "calc", acs: ["AC-1"] });
  expect(events[1]).toMatchObject({ module: "calc", from: "RAW", to: "COOKING" });
  expect(events[3]).toMatchObject({ module: "calc" });
  expect(events[3].review.replaceAll("\\", "/")).toContain(".verid/.state/reviews/");
  expect(t.state().modules.calc.served_at).toBeTruthy();
  expect(verifyAuditChain(t.auditFile).ok).toBe(true);
});

it("retains approvals, TDD evidence and served results when every plugin hook fails", async () => {
  const source = custom({
    hooks: Object.fromEntries(
      ["after-order", "on-state", "after-serve"].map((event) => [
        event,
        'node -e "process.exit(7)"',
      ]),
    ),
  });
  expect((await add(`file:${source}`)).code).toBe(0);
  const order = await t.cli("order", "calc");
  expect(order.code).toBe(0);
  expect(order.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(t.state().modules.calc.served_at).toBeNull();
  t.put("scenario.json", JSON.stringify({ exit: 1, junit: "vitest-red-assert.xml" }));
  expect((await t.cli("taste")).code).toBe(1);
  expect(t.state().tdd.state).toBe("COOKING");
  t.put("scenario.json", JSON.stringify({ exit: 0, junit: "vitest-ac.xml" }));
  expect((await t.cli("taste")).code).toBe(0);
  t.put(".verid/review/calc.md", "# Review\nVerdict: PASS\n");
  expect((await t.reviewStop("verid:reviewer")("LGTM\nVerdict: pass")).code).toBe(0);
  const served = await t.cli("serve", "calc");
  expect(served.code).toBe(0);
  expect(served.stderr).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(t.state().modules.calc.served_at).toBeTruthy();
  expect(t.state().tdd.last_run).toBeTruthy();
  expect(t.auditText()).toContain("plugin_hook_failed");
});

it("previews every command before confirmation and leaves no registration on cancellation or setup failure", async () => {
  const source = custom({ setup: ['node -e "process.exit(9)"'] });
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  const pending = pluginCommand(t.dir, ["add", `file:${source}`], { input, output, color: false });
  let answered = false;
  output.on("data", () => {
    if (!answered && text.includes("? ")) {
      answered = true;
      queueMicrotask(() => input.write("no\n"));
    }
  });
  expect((await pending).exit).toBe(0);
  expect(text).toContain("process.exit(9)");
  expect(text).toContain("after-order");
  expect(existsSync(installed())).toBe(false);
  expect(readPlugins(t.dir).plugins).toEqual([]);
  expect((await add(`file:${source}`)).code).toBe(2);
  expect(readPlugins(t.dir).plugins).toEqual([]);
});

it("checks prerequisites before setup and reports missing code and version drift", async () => {
  const source = custom({
    requires: [{ bin: "verid-missing-tool-unlikely", install: "install it" }],
  });
  expect((await add(`file:${source}`)).stderr).toContain("VERID_BURNT_PLUGIN_REQUIRES");
  expect(readPlugins(t.dir).plugins).toEqual([]);
  expect((await add()).code).toBe(0);
  const file = join(installed(), "verid-plugin.json");
  const value = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...value, version: "9.0.0" }));
  expect((await t.cli("plugin", "doctor")).stdout).toContain("version");
  rmSync(installed(), { recursive: true });
  expect((await t.cli("plugin", "doctor")).code).toBe(1);
  expect((await t.cli("plugin", "doctor")).stdout).toContain("missing");
});

it("copies namespaced resources without granting writer roles and removes only owned files", async () => {
  const source = custom({ skills: ["skills/helper"], agents: ["agents/helper.md"] });
  mkdirSync(join(source, "skills/helper"), { recursive: true });
  mkdirSync(join(source, "agents"));
  writeFileSync(
    join(source, "skills/helper/SKILL.md"),
    "---\nname: helper\ndescription: Help\n---\nRead the files.\n",
  );
  writeFileSync(
    join(source, "agents/helper.md"),
    "---\nname: helper\ndescription: Help\n---\nRead the files.\n",
  );
  const before = t.manifestText();
  expect((await add(`file:${source}`)).code).toBe(0);
  expect(t.read(".claude/skills/sample-helper/SKILL.md")).toContain("name: sample-helper");
  expect(t.read(".claude/agents/sample-helper.md")).toContain("name: sample-helper");
  expect(t.manifestText()).toBe(before);
  const enriched = withPluginDispatch(t.dir, await loadManifest(t.dir));
  expect(writerOf("agent", "sample-helper", enriched?.roles)).toBe("other");
  expect(decideDispatch("Skill", { skill: "sample-helper" }, enriched, new Set()).kind).toBe(
    "allow",
  );
  const dispatch = await t.hook(
    t.fixture("pre-tool-use-agent", (p) => {
      p.tool_input.subagent_type = "sample-helper";
    }),
  );
  expect(dispatch.code).toBe(0);
  expect(t.auditText()).not.toContain("VERID_BURNT_AGENT_NOT_ALLOWED");
  const disabled = registry();
  disabled.plugins[0].enabled = false;
  t.put(".verid/plugins.json", JSON.stringify(disabled));
  expect(
    decideDispatch(
      "Skill",
      { skill: "sample-helper" },
      withPluginDispatch(t.dir, await loadManifest(t.dir)),
      new Set(),
    ).kind,
  ).toBe("deny");
  disabled.plugins[0].enabled = true;
  t.put(".verid/plugins.json", JSON.stringify(disabled));
  rmSync(installed(), { recursive: true });
  expect((await t.cli("cook", "--yes")).code).toBe(0);
  expect(t.read(".claude/skills/sample-helper/SKILL.md")).toContain("name: sample-helper");
  t.editManifest((value) => {
    value.roles.tester = ["verid:tester"];
    value.roles.coder = ["verid:coder"];
  });
  expect((await t.cli("order", "calc")).code).toBe(0);
  expect(await t.actorWrite("sample-helper", "src/add.ts")).toBe("VERID_BURNT_ROLE_CODER_ONLY");
  t.put(".claude/skills/unrelated/SKILL.md", "mine");
  expect((await t.cli("plugin", "remove", "sample")).code).toBe(0);
  expect(existsSync(t.path(".claude/agents/sample-helper.md"))).toBe(false);
  expect(t.read(".claude/skills/unrelated/SKILL.md")).toBe("mine");
});

it("runs setup in the project root and exposes plugin paths and configuration", async () => {
  const command = `node -e 'require("node:fs").writeFileSync("setup-result.json",JSON.stringify({cwd:process.cwd(),plugin:process.env.VERID_PLUGIN_DIR,data:process.env.VERID_PLUGIN_DATA,config:JSON.parse(process.env.VERID_PLUGIN_CONFIG)}))'`;
  expect((await add(`file:${custom({ setup: [command], config: { team: "one" } })}`)).code).toBe(0);
  expect(JSON.parse(t.read("setup-result.json"))).toMatchObject({
    cwd: t.dir,
    config: { team: "one" },
  });
  expect((await t.cli("plugin", "list")).stdout).toContain("sample@1.0.0");
  expect((await add()).code).toBe(2);
  expect(registry().plugins).toHaveLength(1);
});

it("refuses resource collisions before setup and leaves existing content intact", async () => {
  const source = custom({ skills: ["helper"], setup: ['node -e "process.exit(33)"'] });
  mkdirSync(join(source, "helper"));
  writeFileSync(join(source, "helper/SKILL.md"), "---\nname: helper\ndescription: Help\n---\n");
  t.put(".verid/skills/sample-helper/SKILL.md", "mine");
  expect((await add(`file:${source}`)).stderr).toContain("resource already exists");
  expect(t.read(".verid/skills/sample-helper/SKILL.md")).toBe("mine");
  expect(readPlugins(t.dir).plugins).toEqual([]);
  expect(existsSync(installed())).toBe(false);
});

it("rejects linked package resources and linked installation destinations", async () => {
  const source = custom();
  const external = t.newDir("verid-plugin-external-");
  symlinkSync(external, join(source, "linked"), "junction");
  expect((await add(`file:${source}`)).stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
  expect(readPlugins(t.dir).plugins).toEqual([]);
  rmSync(join(source, "linked"));
  mkdirSync(t.path(".verid/.plugins"), { recursive: true });
  symlinkSync(external, installed(), "junction");
  expect((await add()).code).toBe(2);
  expect(readPlugins(t.dir).plugins).toEqual([]);
});

it("reports malformed registries without changing existing gate state", async () => {
  const before = t.read(".verid/.state/state.json");
  t.put(".verid/plugins.json", "not-json");
  expect((await t.cli("plugin", "list")).stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
  expect((await t.cli("doctor", "--ci")).stdout).toContain("! plugins.json:");
  expect(await emitPluginEvent(t.dir, "on-state", { module: "calc" })).toContain(
    "VERID_BURNT_PLUGIN_EVENT",
  );
  expect(t.read(".verid/.state/state.json")).toBe(before);
});

it("reports unavailable prerequisites in doctor and skips local installations in CI", async () => {
  expect((await add()).code).toBe(0);
  const runner = vi
    .spyOn(pluginProcess, "runPluginCommand")
    .mockResolvedValue({ exit: null, timedOut: false, stdout: "", stderr: "not found" });
  try {
    const result = await t.cli("plugin", "doctor");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("missing requirement node");
    rmSync(installed(), { recursive: true });
    expect((await t.cli("doctor", "--ci")).stdout).not.toContain("! plugin:");
  } finally {
    runner.mockRestore();
  }
});

it("does not execute plugins on unchanged or invalid taste evidence", async () => {
  expect((await add()).code).toBe(0);
  t.put("scenario.json", JSON.stringify({ exit: 0, junit: "vitest-ac.xml" }));
  expect((await t.cli("taste")).code).toBe(0);
  expect(existsSync(t.path(".verid/.plugin-data/sample/events.jsonl"))).toBe(false);
  t.put("scenario.json", JSON.stringify({ exit: 0, junit: null }));
  expect((await t.cli("taste")).code).toBe(2);
  expect(existsSync(t.path(".verid/.plugin-data/sample/events.jsonl"))).toBe(false);
});

it("keeps install cancellation and invalid sources from creating registrations", async () => {
  expect((await t.cli("plugin", "add", `file:${sample}`)).stderr).toContain(
    "VERID_BURNT_PLUGIN_CONFIRM",
  );
  expect((await t.cli("plugin", "add", "npm:sample", "--yes")).stderr).toContain(
    "VERID_BURNT_PLUGIN_SOURCE",
  );
  expect((await t.cli("plugin", "remove", "../escape")).stderr).toContain(
    "VERID_BURNT_PLUGIN_INVALID",
  );
  expect((await t.cli("plugin", "run", "sample")).stderr).toContain("VERID_BURNT_PLUGIN_INVALID");
  expect((await t.cli("plugin", "list")).stdout).toContain("No workflow plugins");
  expect(readPlugins(t.dir).plugins).toEqual([]);
});

it("warns about malformed hook output and continues to the next plugin", async () => {
  expect(
    (
      await add(
        `file:${custom({ hooks: { "on-state": 'node -e "console.log(String.fromCharCode(123))"' } })}`,
      )
    ).code,
  ).toBe(0);
  expect((await add(`file:${custom({ name: "second" })}`)).code).toBe(0);
  const before = t.read(".verid/.state/state.json");
  expect(
    await emitPluginEvent(t.dir, "on-state", { module: "calc", from: "RAW", to: "COOKING" }),
  ).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(t.read(".verid/.plugin-data/second/events.jsonl")).toContain("on-state");
  expect(t.read(".verid/.state/state.json")).toBe(before);
});

it("restores missing plugin code on cook and retains the recorded configuration", async () => {
  expect((await add()).code).toBe(0);
  const value = registry();
  value.plugins[0].config = { team: "one" };
  t.put(".verid/plugins.json", JSON.stringify(value));
  rmSync(installed(), { recursive: true });
  expect((await t.cli("cook", "--yes")).code).toBe(0);
  expect(registry().plugins[0].config).toEqual({ team: "one" });
  expect((await t.cli("plugin", "doctor")).code).toBe(0);
  expect(t.read(".verid/.gitignore")).toContain(".plugins/");
  expect(await emitPluginEvent(t.dir, "after-order", { module: "calc", acs: [] })).toBe("");
  expect(t.read(".verid/.plugin-data/sample/events.jsonl")).toContain("calc");
});

it("pins git sources and restores the approved commit after the remote ref advances", async () => {
  const source = custom();
  t.gitAt(source, "init", "-q", "-b", "main");
  t.gitAt(source, "add", ".");
  t.gitAt(source, "commit", "-qm", "initial");
  expect((await add(`git:${source.replaceAll("\\", "/")}#main`)).code).toBe(0);
  const commit = registry().plugins[0].commit;
  writeFileSync(join(source, "later.txt"), "later");
  t.gitAt(source, "add", ".");
  t.gitAt(source, "commit", "-qm", "later");
  rmSync(installed(), { recursive: true });
  expect((await t.cli("cook", "--yes")).code).toBe(0);
  expect(registry().plugins[0].commit).toBe(commit);
  expect(existsSync(join(installed(), "later.txt"))).toBe(false);
});

it("requires confirmation for git restoration before setup and retains the registration", async () => {
  const source = custom();
  t.gitAt(source, "init", "-q", "-b", "main");
  t.gitAt(source, "add", ".");
  t.gitAt(source, "commit", "-qm", "initial");
  expect((await add(`git:${source.replaceAll("\\", "/")}#main`)).code).toBe(0);
  const before = t.read(".verid/plugins.json");
  rmSync(installed(), { recursive: true });
  expect((await t.cli("cook")).stderr).toContain("VERID_BURNT_PLUGIN_CONFIRM");
  expect(t.read(".verid/plugins.json")).toBe(before);
  expect(existsSync(installed())).toBe(false);
});

it("warns and audits a timed out hook while preserving the recorded gate state", async () => {
  expect((await add()).code).toBe(0);
  const before = t.read(".verid/.state/state.json");
  const runner = vi
    .spyOn(pluginProcess, "runPluginCommand")
    .mockResolvedValue({ exit: null, timedOut: true, stdout: "", stderr: "" });
  try {
    expect(
      await emitPluginEvent(t.dir, "on-state", { module: "calc", from: "RAW", to: "COOKING" }),
    ).toContain("timed out");
    expect(t.read(".verid/.state/state.json")).toBe(before);
    expect(t.auditText()).toContain("plugin_hook_failed");
  } finally {
    runner.mockRestore();
  }
});

it("refuses changed file sources on restoration before executing their hooks", async () => {
  const source = custom();
  expect((await add(`file:${source}`)).code).toBe(0);
  rmSync(installed(), { recursive: true });
  writeFileSync(join(source, "unapproved.mjs"), "process.exit(5)");
  expect((await t.cli("cook", "--yes")).stderr).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  expect(existsSync(installed())).toBe(false);
});

it("isolates invalid JSON, timeouts, disabled plugins and changed code from gate state", async () => {
  expect(
    (await add(`file:${custom({ hooks: { "on-state": 'node -e "console.log(123)"' } })}`)).code,
  ).toBe(0);
  const before = t.read(".verid/.state/state.json");
  expect(
    await emitPluginEvent(t.dir, "on-state", { module: "calc", from: "RAW", to: "COOKING" }),
  ).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(t.read(".verid/.state/state.json")).toBe(before);
  const timed = await runPluginCommand('node -e "setInterval(()=>{},1000)"', t.dir, {}, "{}", 20);
  expect(timed.timedOut).toBe(true);
  const value = registry();
  value.plugins[0].enabled = false;
  t.put(".verid/plugins.json", JSON.stringify(value));
  expect(await emitPluginEvent(t.dir, "on-state", { module: "calc" })).toBe("");
  value.plugins[0].enabled = true;
  t.put(".verid/plugins.json", JSON.stringify(value));
  writeFileSync(join(installed(), "extra.mjs"), "evil");
  expect(await emitPluginEvent(t.dir, "on-state", { module: "calc" })).toContain(
    "VERID_BURNT_PLUGIN_INTEGRITY",
  );
  expect(t.read(".verid/.state/state.json")).toBe(before);
});
