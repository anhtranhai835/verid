import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest } from "../../src/adapters/manifest.js";
import { launchable } from "../../src/adapters/architecture.js";
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
// A timed-out checker's process tree can hold the folder a moment longer on Windows.
const CLEANUP = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;
afterEach(() => {
  rmSync(project, CLEANUP);
  for (const dir of outside.splice(0)) rmSync(dir, CLEANUP);
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

describe("architecture checks are advisory", () => {
  it("records pass, fail, missing and timed-out checkers without failing passing tests", async () => {
    const rows = [
      [checker(0), "pass"],
      [checker(1), "fail"],
      ["verid-no-such-checker-xyz", "unavailable"],
      [checker(0, 1800), "unavailable"],
    ];
    for (const [command, status] of rows) {
      setManifest({ command, inputs: INPUTS, timeout_sec: 1 });
      const r = await cli("taste");
      expect(r.code, r.stderr).toBe(0);
      expect(state().architecture["."].status).toBe(status);
      expect(state().tdd.state).toBe("RAW");
    }
  });
  it("runs a checker only after passing tests and never adds AC coverage", async () => {
    const rows = [
      [1, "vitest-red-assert.xml", false],
      [0, "vitest-green.xml", true],
    ] as const;
    for (const [exit, junit, ran] of rows) {
      put(".verid/.state/state.json", '{"schemaVersion":1,"baseline":[]}');
      scenario(exit, junit);
      const r = await cli("taste");
      expect(r.code).toBe(exit);
      expect(!!state().architecture["."]).toBe(ran);
      expect(state().tdd.passed_acs).toEqual([]);
    }
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
