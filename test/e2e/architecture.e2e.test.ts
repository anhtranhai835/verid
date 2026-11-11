import { tempProject, architectureManifest as manifest, type Run } from "../support/project.js";
import { existsSync, readdirSync, rmSync } from "node:fs";

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchable } from "../../src/adapters/architecture.js";

const CHECKER = join(import.meta.dirname, "fake-checker.mjs");

let project: string;
const outside: string[] = [];

const checker = (exit: number, delay = 0, file = "") =>
  `"${process.execPath}" "${CHECKER}" ${exit} ${delay} ${file}`.trimEnd();
const INPUTS = [".dependency-cruiser.cjs", "package-lock.json", "rules/*.cjs"];

const scenario = (exit: number, junit: string) =>
  put("scenario.json", JSON.stringify({ exit, junit, output: "fake runner output" }));
const setManifest = (
  check: Record<string, unknown> | null,
  mode = "remix",
  extra?: string,
  globs?: string,
) => put(".verid/manifest.yaml", manifest(check, mode, extra, globs));

const t = tempProject("verid-architecture-", {
  state: '{"schemaVersion":1,"baseline":[]}',
  cleanup: { maxRetries: 10, retryDelay: 200 },
  bind: (p) => {
    project = p.dir;
  },
  setup: () => {
    setManifest({ command: checker(0), inputs: INPUTS, timeout_sec: 30 });
    put(".dependency-cruiser.cjs", "module.exports = { forbidden: [] };\n");
    put("package-lock.json", '{"lockfileVersion":3}\n');
    put("rules/layers.cjs", "module.exports = ['domain', 'application'];\n");
    put("src/a.ts", "export const a = 1;\n");
    put("test/a.test.ts", "// AC-1\n");
    scenario(0, "vitest-green.xml");
  },
  teardown: () => {
    for (const dir of outside.splice(0)) rmSync(dir, CLEANUP);
  },
});
const { put, state, cli, hook, write } = t;
// A timed-out checker's process tree can hold the folder a moment longer on Windows.
const CLEANUP = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;

const verdict = (r: Run) =>
  r.code === 0 ? "exit 0" : (/verid \[(\w+)\]/.exec(r.stderr)?.[1] ?? `exit ${r.code}`);

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
