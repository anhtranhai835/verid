import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest } from "../../src/adapters/manifest.js";
import { architectureOf } from "../../src/adapters/plan-file.js";
import { readState, statePaths } from "../../src/adapters/state-store.js";
import { contentsOf, launchable } from "../../src/adapters/architecture.js";
import { runCli, runHook } from "./in-process.js";

// verid taste runs a project-owned architecture checker after a passing suite. The suite is the
// fake runner (scenario.json picks a recorded JUnit report) and the checker a script whose exit,
// delay and side effect come from its arguments. CLI and hook run in process.
const root = join(import.meta.dirname, "..", "..");
const RUNNER = join(import.meta.dirname, "fake-runner.mjs");
const CHECKER = join(import.meta.dirname, "fake-checker.mjs");
const FIXTURES = join(root, "test", "fixtures", "claude-code");
const SESSION = "11111111-2222-3333-4444-555555555555";

let project: string;
const outside: string[] = [];

const checker = (exit: number, delay = 0, file = "") =>
  `"${process.execPath}" "${CHECKER}" ${exit} ${delay} ${file}`.trimEnd();
const INPUTS = [".dependency-cruiser.cjs", "package-lock.json", "rules/*.cjs"];

// The repo's globs; the default layout keeps code and tests in top-level folders.
const SRC_TEST = '    source_globs: ["src/**"]\n    test_globs: ["test/**"]';
const manifest = (
  check: Record<string, unknown> | null,
  mode = "remix",
  extra = 'roles:\n  reviewer: ["verid:reviewer"]\n',
  globs = SRC_TEST,
) =>
  [
    "schemaVersion: 1",
    `mode: ${mode}`,
    ...(mode === "remix" ? [] : [extra.trimEnd()]),
    "repos:",
    "  - path: .",
    `    test_cmd: ${JSON.stringify(`"${process.execPath}" "${RUNNER}" {junit}`)}`,
    globs,
    ...(check ? [`    architecture_check: ${JSON.stringify(check)}`] : []),
    "",
  ].join("\n");

const put = (rel: string, text: string) => {
  const file = join(project, ...rel.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const read = (rel: string) => readFileSync(join(project, ...rel.split("/")), "utf8");
const state = () => JSON.parse(read(".verid/.state/state.json"));
const scenario = (exit: number, junit: string) =>
  put("scenario.json", JSON.stringify({ exit, junit, output: "fake runner output" }));
const setManifest = (
  check: Record<string, unknown> | null,
  mode = "remix",
  extra?: string,
  globs?: string,
) => put(".verid/manifest.yaml", manifest(check, mode, extra, globs));

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-architecture-"));
  put(".verid/.state/state.json", '{"schemaVersion":1,"baseline":[]}');
  setManifest({ command: checker(0), inputs: INPUTS, timeout_sec: 30 });
  put(".dependency-cruiser.cjs", "module.exports = { forbidden: [] };\n");
  put("package-lock.json", '{"lockfileVersion":3}\n');
  put("rules/layers.cjs", "module.exports = ['domain', 'application'];\n");
  put("src/a.ts", "export const a = 1;\n");
  put("test/a.test.ts", "// AC-1\n");
  scenario(0, "vitest-green.xml");
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  for (const dir of outside.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}
const cli = (...args: string[]): Promise<Run> =>
  runCli(args, project, { CLAUDE_PROJECT_DIR: project });
const hook = (input: string): Promise<Run> => runHook(input, { CLAUDE_PROJECT_DIR: project });
const verdict = (r: Run) =>
  r.code === 0 ? "exit 0" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? `exit ${r.code}`);

type Payload = Record<string, any>;
const esc = (s: string) => JSON.stringify(s).slice(1, -1);
function fixture(name: string, edit?: (p: Payload) => void): string {
  const text = readFileSync(join(FIXTURES, `${name}.json`), "utf8")
    .replaceAll("{{CWD}}", () => esc(project))
    .replaceAll("{{HOME}}", esc(homedir()))
    .replaceAll("{{SESSION_ID}}", SESSION)
    .replaceAll(/\{\{[A-Z_]+\}\}/g, "placeholder");
  const payload = JSON.parse(text) as Payload;
  edit?.(payload);
  return JSON.stringify(payload);
}
const write = (rel: string, agent?: string) =>
  fixture(agent ? "pre-tool-use-write-from-plugin-agent" : "pre-tool-use-write", (p) => {
    p.tool_input.file_path = join(project, ...rel.split("/"));
    if (agent) p.agent_type = agent;
  });

// What the close gates read now: every configured repo's problem, or fresh.
const readiness = async () => {
  const m = await loadManifest(project);
  const problems = architectureOf(
    project,
    m!,
    readState(statePaths(project)),
    contentsOf(project, m!),
  );
  return problems.map((p) => `${p.repo} ${p.code}`).join(", ") || "fresh";
};

// A prep project in the human drive with module calc ordered.
async function ordered(check: Record<string, unknown>): Promise<void> {
  setManifest(check, "prep");
  put(".verid/research.md", "# Research\n");
  put(".verid/design.md", "# Design\n");
  put(".verid/plan.md", "## Module: calc\n- AC-1: adds two numbers\n");
  expect((await cli("order", "calc")).code).toBe(0);
  scenario(0, "vitest-ac.xml");
}

describe("verid taste runs the architecture check", () => {
  it("records what the checker showed after a passing suite: a pass, a failure, or no evidence", async () => {
    const linked = mkdtempSync(join(tmpdir(), "verid-architecture-outside-"));
    outside.push(linked);
    writeFileSync(join(linked, "rules.cjs"), "module.exports = [];\n");
    const rows: [string, Record<string, unknown>][] = [
      ["exit 0", { command: checker(0), inputs: INPUTS }],
      ["exit 1", { command: checker(1), inputs: INPUTS }],
      ["missing command", { command: "verid-no-such-checker-xyz --rules x", inputs: INPUTS }],
      ["missing input", { command: checker(0), inputs: ["missing.cjs"] }],
      ["empty match", { command: checker(0), inputs: ["rules/*.mjs"] }],
      ["timeout", { command: checker(0, 5000), inputs: INPUTS, timeout_sec: 1 }],
      ["path escape", { command: checker(0), inputs: ["linked/**"] }],
    ];
    const outcomes: Record<string, string> = {};
    for (const [name, check] of rows) {
      rmSync(join(project, "linked"), { recursive: true, force: true });
      if (name === "path escape") symlinkSync(linked, join(project, "linked"), "junction");
      put(".verid/.state/state.json", '{"schemaVersion":1,"baseline":[]}');
      setManifest(check);
      const r = await cli("taste");
      // The agent cannot read .verid/.state, so the checker's own output is shown to it.
      outcomes[name] = [
        verdict(r),
        ...(r.stderr.includes("architecture-0.log") ? ["log"] : []),
        ...(r.stderr.includes("fake checker: exit") ? ["output"] : []),
      ].join(" · ");
    }
    expect(outcomes).toEqual({
      "exit 0": "exit 0",
      "exit 1": "VERID_BURNT_ARCHITECTURE_FAILED · log · output",
      "missing command": "VERID_BURNT_ARCHITECTURE_UNAVAILABLE · log",
      "missing input": "VERID_BURNT_ARCHITECTURE_UNAVAILABLE",
      "empty match": "VERID_BURNT_ARCHITECTURE_UNAVAILABLE",
      timeout: "VERID_BURNT_ARCHITECTURE_UNAVAILABLE · log · output",
      "path escape": "VERID_BURNT_ARCHITECTURE_UNAVAILABLE",
    });
  });

  it("keeps the test cycle apart: the check never moves it, gives no AC coverage and runs only after a pass", async () => {
    const rows: [string, string, string, number][] = [
      ["passing suite, failing check", "COOKING", "vitest-green.xml", 1],
      ["passing suite with an AC, passing check", "RAW", "vitest-ac.xml", 0],
      ["assertion failure", "RAW", "vitest-red-assert.xml", 0],
    ];
    const outcomes: Record<string, unknown> = {};
    for (const [name, from, junit, checkerExit] of rows) {
      put(
        ".verid/.state/state.json",
        JSON.stringify({ schemaVersion: 1, baseline: [], tdd: { state: from, last_run: null } }),
      );
      setManifest({ command: checker(checkerExit), inputs: INPUTS });
      scenario(junit === "vitest-red-assert.xml" ? 1 : 0, junit);
      const r = await cli("taste");
      const s = state();
      outcomes[name] = [r.code, s.tdd.state, s.tdd.passed_acs, Object.keys(s.architecture)];
    }
    expect(outcomes).toEqual({
      "passing suite, failing check": [2, "PLATED", [], ["."]],
      "passing suite with an AC, passing check": [0, "RAW", ["AC-1"], ["."]],
      "assertion failure": [1, "COOKING", [], []],
    });
  });

  it("needs a new pass once anything the check read changes, and finds the old one again when it is restored", async () => {
    await ordered({ command: checker(0), inputs: INPUTS });
    expect((await cli("taste")).code).toBe(0);
    const change = (rel: string) => {
      const before = read(rel);
      appendFileSync(join(project, ...rel.split("/")), "// changed\n");
      return () => put(rel, before);
    };
    const rows: [string, () => () => void][] = [
      ["unchanged", () => () => {}],
      ["source", () => change("src/a.ts")],
      ["test", () => change("test/a.test.ts")],
      ["config", () => change(".dependency-cruiser.cjs")],
      ["lockfile", () => change("package-lock.json")],
      ["rule", () => change("rules/layers.cjs")],
      [
        "added source",
        () => (
          put("src/b.ts", "export const b = 2;\n"),
          () => rmSync(join(project, "src", "b.ts"))
        ),
      ],
      [
        "deleted source",
        () => (
          rmSync(join(project, "src", "a.ts")),
          () => put("src/a.ts", "export const a = 1;\n")
        ),
      ],
      [
        "command",
        () => {
          const before = read(".verid/manifest.yaml");
          setManifest({ command: checker(0, 1), inputs: INPUTS }, "prep");
          return () => put(".verid/manifest.yaml", before);
        },
      ],
      ["design", () => change(".verid/design.md")],
      ["restored", () => () => {}],
    ];
    const outcomes: Record<string, string> = {};
    for (const [name, apply] of rows) {
      const restore = apply();
      outcomes[name] = await readiness();
      restore();
    }
    // Last: a new approval of the same module cannot be undone.
    expect((await cli("order", "calc")).code).toBe(0);
    outcomes.approval = await readiness();
    expect(outcomes).toEqual({
      unchanged: "fresh",
      source: ". VERID_BURNT_ARCHITECTURE_STALE",
      test: ". VERID_BURNT_ARCHITECTURE_STALE",
      config: ". VERID_BURNT_ARCHITECTURE_STALE",
      lockfile: ". VERID_BURNT_ARCHITECTURE_STALE",
      rule: ". VERID_BURNT_ARCHITECTURE_STALE",
      "added source": ". VERID_BURNT_ARCHITECTURE_STALE",
      "deleted source": ". VERID_BURNT_ARCHITECTURE_STALE",
      command: ". VERID_BURNT_ARCHITECTURE_STALE",
      design: ". VERID_BURNT_ARCHITECTURE_STALE",
      restored: "fresh",
      approval: ". VERID_BURNT_ARCHITECTURE_STALE",
    });
  });

  it("covers code and tests under nested globs, and skips only the folders the manifest frees", async () => {
    const MAVEN = [
      '    source_globs: ["src/main/java/**"]',
      '    test_globs: ["src/test/java/**"]',
      '    ignore_globs: ["**/node_modules/**", "src/main/java/gen/*"]',
    ].join("\n");
    setManifest({ command: checker(0), inputs: ["pom.xml"] }, "remix", undefined, MAVEN);
    put("pom.xml", "<project/>\n");
    put("src/main/java/app/App.java", "class App {}\n");
    put("src/test/java/app/AppTest.java", "class AppTest {}\n");
    put("node_modules/lib/index.js", "module.exports = 1;\n");
    // `gen/*` frees the files right in gen/, not the code deeper down.
    put("src/main/java/gen/Top.java", "class Top {}\n");
    put("src/main/java/gen/deep/Deep.java", "class Deep {}\n");
    expect((await cli("taste")).code).toBe(0);
    const change = (rel: string) => {
      const before = read(rel);
      appendFileSync(join(project, ...rel.split("/")), "// changed\n");
      return () => put(rel, before);
    };
    const rows: [string, () => () => void][] = [
      ["unchanged", () => () => {}],
      ["code", () => change("src/main/java/app/App.java")],
      ["test", () => change("src/test/java/app/AppTest.java")],
      [
        "added code",
        () => (
          put("src/main/java/app/Port.java", "interface Port {}\n"),
          () => rmSync(join(project, "src", "main", "java", "app", "Port.java"))
        ),
      ],
      ["a freed folder", () => change("node_modules/lib/index.js")],
      ["a freed file", () => change("src/main/java/gen/Top.java")],
      ["code under a freed file pattern", () => change("src/main/java/gen/deep/Deep.java")],
    ];
    const outcomes: Record<string, string> = {};
    for (const [name, apply] of rows) {
      const restore = apply();
      outcomes[name] = await readiness();
      restore();
    }
    expect(outcomes).toEqual({
      unchanged: "fresh",
      code: ". VERID_BURNT_ARCHITECTURE_STALE",
      test: ". VERID_BURNT_ARCHITECTURE_STALE",
      "added code": ". VERID_BURNT_ARCHITECTURE_STALE",
      "a freed folder": "fresh",
      "a freed file": "fresh",
      "code under a freed file pattern": ". VERID_BURNT_ARCHITECTURE_STALE",
    });
  });

  it("leaves hidden tool folders out of the snapshot unless an input names a file there", async () => {
    // As cook writes it: every file is code, so Gradle's .gradle/ cache would count too.
    const ALL = '    source_globs: ["**"]\n    test_globs: ["test/**"]';
    const inputs = ["package-lock.json", ".archunit/rules.txt"];
    setManifest({ command: checker(0), inputs }, "remix", undefined, ALL);
    put(".gradle/8.5/fileHashes.bin", "hashes\n");
    put(".archunit/rules.txt", "layers\n");
    expect((await cli("taste")).code).toBe(0);
    const change = (rel: string) => {
      const before = read(rel);
      appendFileSync(join(project, ...rel.split("/")), "changed\n");
      return () => put(rel, before);
    };
    const rows: [string, () => () => void][] = [
      ["a tool cache in a hidden folder", () => change(".gradle/8.5/fileHashes.bin")],
      ["a declared input in a hidden folder", () => change(".archunit/rules.txt")],
      ["code", () => change("src/a.ts")],
    ];
    const outcomes: Record<string, string> = {};
    for (const [name, apply] of rows) {
      const restore = apply();
      outcomes[name] = await readiness();
      restore();
    }
    expect(outcomes).toEqual({
      "a tool cache in a hidden folder": "fresh",
      "a declared input in a hidden folder": ". VERID_BURNT_ARCHITECTURE_STALE",
      code: ". VERID_BURNT_ARCHITECTURE_STALE",
    });
  });

  it("records no pass for a run during which a file it reads changed, or the hook saw a write", async () => {
    // As a write the hook judged does: the TDD revision moves on.
    const bumpRev = `node -e "const fs=require('fs'),f='.verid/.state/state.json',s=JSON.parse(fs.readFileSync(f,'utf8'));s.tdd.rev++;fs.writeFileSync(f,JSON.stringify(s))"`;
    const rows: [string, string][] = [
      ["a file it reads changed", checker(0, 0, "src/a.ts")],
      ["the hook saw a write", bumpRev],
    ];
    const outcomes: Record<string, unknown> = {};
    for (const [name, command] of rows) {
      await ordered({ command, inputs: INPUTS });
      const r = await cli("taste");
      outcomes[name] = [verdict(r), state().architecture, await readiness()];
    }
    expect(outcomes).toEqual({
      "a file it reads changed": [
        "VERID_BURNT_ARCHITECTURE_STALE",
        {},
        ". VERID_BURNT_ARCHITECTURE_STALE",
      ],
      "the hook saw a write": [
        "VERID_BURNT_ARCHITECTURE_STALE",
        {},
        ". VERID_BURNT_ARCHITECTURE_STALE",
      ],
    });
  });

  it("starts only a command whose program it can find, leaving shell forms to the shell", () => {
    // A Store-installed program is an App Execution Alias, which stat cannot follow.
    const apps = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps");
    const alias =
      process.platform === "win32" && existsSync(apps)
        ? readdirSync(apps).find((name) => name.endsWith(".exe"))
        : undefined;
    const rows: [string, boolean][] = [
      ...(alias ? ([[`"${join(apps, alias)}" --version`, true]] as [string, boolean][]) : []),
      [`"${process.execPath}" -v`, true],
      ["node -v", true],
      ["verid-no-such-checker-xyz --rules x", false],
      ["./no-such-wrapper.cmd test", false],
      ["cd api && npm run architecture", true],
      ["FOO=1 lint-imports", true],
      ["(lint-imports)", true],
    ];
    expect(
      Object.fromEntries(rows.map(([command]) => [command, launchable(command, project)])),
    ).toEqual(Object.fromEntries(rows));
  });
});

describe("the design table and the agent", () => {
  it("signs the design table's bytes: an edited cell or line endings lock code until a new order", async () => {
    const TABLE = [
      "# Design",
      "",
      "| Repo | Bounded context / owner | Layer | Paths | Public interface | May depend on |",
      "| --- | --- | --- | --- | --- | --- |",
      "| api | ordering / orders team | domain | `src/ordering/domain/**` | aggregate operations | domain only |",
      "",
    ].join("\n");
    const outcomes: Record<string, string> = {};
    put(
      ".verid/.state/state.json",
      JSON.stringify({ schemaVersion: 1, tdd: { state: "COOKING", last_run: null } }),
    );
    setManifest(null, "prep");
    put(".verid/research.md", "# Research\n");
    put(".verid/design.md", TABLE);
    put(".verid/plan.md", "## Module: calc\n- AC-1: adds two numbers\n");
    await cli("order", "calc");
    outcomes.ordered = verdict(await hook(write("src/a.ts")));
    put(".verid/design.md", TABLE.replace("domain only", "domain and adapters"));
    outcomes["table cell edited"] = verdict(await hook(write("src/a.ts")));
    put(".verid/design.md", TABLE.replaceAll("\n", "\r\n"));
    outcomes["line endings only"] = verdict(await hook(write("src/a.ts")));
    await cli("order", "calc");
    outcomes["ordered again"] = verdict(await hook(write("src/a.ts")));

    setManifest(
      null,
      "prep",
      'drive: auto\nroles:\n  reviewer: ["verid:reviewer"]\n  tester: ["verid:tester"]\n  coder: ["verid:coder"]\n',
    );
    put(".verid/design.md", TABLE);
    await cli("order");
    put(".verid/design.md", TABLE.replace("domain only", "domain and adapters"));
    outcomes["auto: table cell edited"] = verdict(await hook(write("src/a.ts", "verid:coder")));

    setManifest(null, "remix");
    outcomes["remix: table edited"] = verdict(await hook(write("src/a.ts")));
    expect(outcomes).toEqual({
      ordered: "exit 0",
      "table cell edited": "VERID_BURNT_PLAN_NOT_APPROVED",
      "line endings only": "VERID_BURNT_PLAN_NOT_APPROVED",
      "ordered again": "exit 0",
      "auto: table cell edited": "VERID_BURNT_AUTO_STUCK",
      "remix: table edited": "exit 0",
    });
  });

  it("keeps the checker's results and logs out of the agent's reach", async () => {
    expect((await cli("taste")).code).toBe(0);
    const run = state().architecture["."].run as string;
    const rows: [string, string][] = [
      ["state", ".verid/.state/state.json"],
      ["checker log", `.verid/.state/runs/${run}/architecture-0.log`],
    ];
    // In process, one call at a time.
    const outcomes: Record<string, string> = {};
    for (const [name, rel] of rows) outcomes[name] = verdict(await hook(write(rel)));
    expect(outcomes).toEqual({
      state: "VERID_BURNT_STATE_PROTECTED",
      "checker log": "VERID_BURNT_STATE_PROTECTED",
    });
  });
});
