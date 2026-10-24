import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

const root = join(import.meta.dirname, "..", "..");
const CLI = join(root, "dist", "cli.js");
const HOOK = join(root, "dist", "hook.js");
const FLAGS = [
  "--iterations",
  "--duration",
  "1 weeks",
  "--start-date",
  "2026-10-12",
  "--demo-day",
  "Friday",
];
let fixture: string;
let project: string;
let clock: string;
beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "verid-iterations-e2e-"));
  project = join(fixture, "project");
  mkdirSync(project);
  clock = join(fixture, "clock.cjs");
  freezeClock("2026-10-24T12:00:00.000Z");
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function freezeClock(instant: string) {
  writeFileSync(
    clock,
    `const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...args) { if (args.length === 0) super(${JSON.stringify(instant)}); else super(...args); }
  static now() { return new RealDate(${JSON.stringify(instant)}).valueOf(); }
};\n`,
  );
}

function run(file: string, args: string[], input?: object, timezone = "UTC") {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("CLAUDE")),
  );
  const result = spawnSync(process.execPath, ["--require", clock, file, ...args], {
    cwd: project,
    env: { ...env, TZ: timezone },
    encoding: "utf8",
    ...(input && { input: JSON.stringify(input) }),
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
const cli = (...args: string[]) => run(CLI, args);
const manifest = () => readFileSync(join(project, ".verid", "manifest.yaml"), "utf8");
const put = (name: string, text: string) => writeFileSync(join(project, ".verid", name), text);
const productionWrite = () =>
  run(HOOK, [], {
    hook_event_name: "PreToolUse",
    session_id: "iterations-session",
    cwd: project,
    tool_name: "Write",
    tool_input: {
      file_path: join(project, "src", "auth.ts"),
      content: "export const auth = true;",
    },
    agent_id: "coder",
    agent_type: "verid:coder",
  });
const reviewPlan = () =>
  run(HOOK, [], {
    hook_event_name: "SubagentStop",
    session_id: "iterations-session",
    cwd: project,
    agent_id: "reviewer",
    agent_type: "verid:reviewer",
    last_assistant_message: "Verdict: pass",
    stop_hook_active: false,
  });
function cooking() {
  const file = join(project, ".verid", ".state", "state.json");
  const state = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    JSON.stringify({ ...state, tdd: { ...state.tdd, state: "COOKING", last_run: "red" } }),
  );
}

describe("iterations through the real CLI and hook", () => {
  it("cooks iteration flags in prep and recipe", () => {
    const rows = [
      {
        mode: "prep",
        duration: "1 week",
        expected: { duration: "1 week", start_date: "2026-10-12", demo_day: "Friday" },
      },
      {
        mode: "recipe",
        duration: "1 day",
        expected: { duration: "1 day", start_date: "2026-10-12", demo_day: "Friday" },
      },
    ];
    for (const row of rows) {
      const cooked = cli(
        "cook",
        "--mode",
        row.mode,
        ...FLAGS,
        "--duration",
        row.duration,
        "--yes",
        "--lang",
        "en",
      );
      expect(cooked.code, cooked.stderr).toBe(0);
      expect(parse(manifest()).iterations).toEqual(row.expected);
      rmSync(join(project, ".verid"), { recursive: true, force: true });
      rmSync(join(project, ".claude"), { recursive: true, force: true });
    }
  });

  it("previews iterations without writing with --dry-run", () => {
    const rows = [["--dry-run"], ["--dry-run", "--yes"]];
    for (const flags of rows) {
      const preview = cli("cook", "--mode", "prep", ...FLAGS, ...flags, "--lang", "en");
      expect(preview.code, preview.stderr).toBe(0);
      expect(preview.stdout).toContain("+ manifest.yaml");
      expect(preview.stdout).toContain(
        '! iterations:\n!   duration: "1 weeks"\n!   start_date: "2026-10-12"\n!   demo_day: "Friday"',
      );
      expect(readdirSync(project)).toEqual([]);
    }
  });

  it("ignores every iteration flag with a note once a manifest exists", () => {
    const manifests = [{ flags: [] }, { flags: FLAGS }];
    const rows = [
      ["--iterations"],
      ["--duration", "bad"],
      ["--start-date", "bad"],
      ["--demo-day", "bad"],
      ["--iterations", "--duration", "bad", "--start-date", "bad", "--demo-day", "bad"],
    ];
    for (const setup of manifests) {
      expect(cli("cook", "--mode", "prep", "--lang", "en", ...setup.flags).code).toBe(0);
      const before = manifest();
      for (const flags of rows) {
        const ignored = cli("cook", ...flags);
        expect(ignored.code, ignored.stderr).toBe(0);
        expect(ignored.stdout).toContain("ignored");
        expect(manifest()).toBe(before);
      }
      rmSync(join(project, ".verid"), { recursive: true, force: true });
      rmSync(join(project, ".claude"), { recursive: true, force: true });
    }
  });

  it("refuses incomplete or invalid iteration flags without writing and names the flag", () => {
    const rows = [
      { flags: ["--iterations"], detail: "--duration" },
      { flags: ["--iterations", "--duration", "2 weeks"], detail: "--start-date" },
      {
        flags: ["--iterations", "--duration", "2 weeks", "--start-date", "2026-10-12"],
        detail: "--demo-day",
      },
      { flags: ["--duration", "2 weeks"], detail: "--iterations" },
      { flags: [...FLAGS, "--duration", "0 days"], detail: "--duration" },
      { flags: [...FLAGS, "--start-date", "2026-02-29"], detail: "--start-date" },
      { flags: [...FLAGS, "--demo-day", "friday"], detail: "--demo-day" },
      { flags: ["--mode", "remix", ...FLAGS], detail: "--iterations" },
    ];
    for (const row of rows) {
      const result = cli("cook", "--mode", "prep", "--lang", "en", ...row.flags);
      expect(result.code, row.flags.join(" ")).toBe(2);
      expect(result.stderr).toContain("VERID_BURNT_INIT_INVALID");
      expect(result.stderr).toContain(row.detail);
      expect(readdirSync(project)).toEqual([]);
    }
  });

  it("reports invalid manifest iterations with the existing bilingual validation code", () => {
    mkdirSync(join(project, ".verid"));
    put(
      "manifest.yaml",
      'schemaVersion: 1\nmode: prep\niterations: {duration: "0 days", start_date: "2026-10-12", demo_day: Friday}\nrepos:\n  - source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
    );
    const result = cli("menu");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("VERID_BURNT_MANIFEST_INVALID");
    expect(result.stderr).toContain("iterations.duration");
    expect(result.stderr).toContain("vi:");
    expect(result.stderr).toContain("en:");
  });

  it("shows the same iteration status in menu and session start with a fixed date", () => {
    expect(cli("cook", "--mode", "prep", "--lang", "en", ...FLAGS).code).toBe(0);
    put(
      "plan.md",
      "## Module: auth\nIteration: 1\n- AC-1: signs in\n## Module: product\nIteration: 2\n- AC-9 (e2e): uses the product\n",
    );
    const expected = [
      "  iteration 2 · 2026-10-19 – 2026-10-25 · demo passed · 0/1 modules served",
      "  auth · iteration 1 · late",
    ];
    const menu = cli("menu");
    const start = run(HOOK, [], {
      hook_event_name: "SessionStart",
      session_id: "iterations-session",
      cwd: project,
      source: "startup",
    });
    expect([menu.code, start.code]).toEqual([0, 0]);
    for (const line of expected) {
      expect(menu.stdout).toContain(line);
      expect(start.stdout).toContain(line);
    }
  });

  it("refuses invalid human-drive iteration metadata while other modules still obey TDD", () => {
    expect(cli("cook", "--mode", "prep", "--lang", "en", ...FLAGS).code).toBe(0);
    put("design.md", "design");
    put("research.md", "research");
    put(
      "plan.md",
      "## Module: invalid\nIteration: nope\n- AC-1: invalid\n## Module: future\nIteration: 99\n- AC-2: future\n",
    );
    const invalid = cli("order", "invalid");
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("VERID_BURNT_PLAN_INVALID");
    expect(invalid.stderr).toContain("Iteration must be a positive integer");
    expect(cli("order", "future").code).toBe(0);
    const denied = run(HOOK, [], {
      hook_event_name: "PreToolUse",
      session_id: "iterations-session",
      cwd: project,
      tool_name: "Write",
      tool_input: {
        file_path: join(project, "src", "future.ts"),
        content: "export const future = true;",
      },
      agent_id: "coder",
      agent_type: "verid:coder",
    });
    expect(denied.code).toBe(2);
    expect(denied.stderr).toContain("VERID_BURNT_TDD_NO_FAILING_TEST");
  });

  it("uses the menu's local calendar date when UTC is still yesterday", () => {
    freezeClock("2026-10-24T18:30:00.000Z");
    expect(
      cli(
        "cook",
        "--mode",
        "prep",
        "--lang",
        "en",
        ...FLAGS,
        "--duration",
        "1 days",
        "--start-date",
        "2026-10-24",
      ).code,
    ).toBe(0);
    const rows = [
      { timezone: "UTC", expected: "iteration 1 · 2026-10-24 – 2026-10-24" },
      { timezone: "Asia/Bangkok", expected: "iteration 2 · 2026-10-25 – 2026-10-25" },
    ];
    for (const row of rows) {
      const menu = run(CLI, ["menu"], undefined, row.timezone);
      expect(menu.code, menu.stderr).toBe(0);
      expect(menu.stdout).toContain(row.expected);
    }
  });

  it("ignores deeper Iteration prose in both drives, and all iteration text when disabled", () => {
    const rows = [
      {
        name: "human-off",
        drive: "human",
        enabled: false,
        body: "A description\nIteration: TBD\n",
      },
      { name: "human-on", drive: "human", enabled: true, body: "A description\nIteration: TBD\n" },
      { name: "auto-off", drive: "auto", enabled: false, body: "A description\nIteration: TBD\n" },
      { name: "auto-on", drive: "auto", enabled: true, body: "A description\nIteration: TBD\n" },
      { name: "human-heading-off", drive: "human", enabled: false, body: "Iteration: TBD\n" },
      { name: "auto-heading-off", drive: "auto", enabled: false, body: "Iteration: TBD\n" },
      {
        name: "auto-metadata-prose",
        drive: "auto",
        enabled: true,
        body: "Iteration: 2\nIteration: TBD\n",
      },
    ];
    // Setup is covered above. Share its generated files and keep each row's approvals fresh.
    expect(cli("cook", "--mode", "prep", "--lang", "en").code).toBe(0);
    const base = parse(manifest());
    put("research.md", "research");
    put("design.md", "design");
    for (const row of rows) {
      put(
        "manifest.yaml",
        stringify({
          ...base,
          drive: row.drive,
          ...(row.enabled && {
            iterations: { duration: "1 weeks", start_date: "2026-10-12", demo_day: "Friday" },
          }),
        }),
      );
      put(".state/state.json", '{"schemaVersion":1,"language":"en"}');
      put(
        "plan.md",
        `## Module: auth\n${row.body}- AC-1: signs in\n## Module: product\n- AC-9 (e2e): uses the product\n`,
      );
      const ordered = cli("order", ...(row.drive === "human" ? ["auth"] : []));
      expect(ordered.code, `${row.name}: ${ordered.stderr}`).toBe(0);
      if (row.drive === "auto") expect(reviewPlan().code).toBe(0);
      cooking();
      const write = productionWrite();
      expect(write.code, `${row.name}: ${write.stderr}`).toBe(0);
      expect(
        JSON.parse(readFileSync(join(project, ".verid/.state/state.json"), "utf8")).tdd.state,
        row.name,
      ).toBe("COOKING");
    }
    expect(cli("menu").stdout).toContain("auth · cooking");
  });

  it("holds the whole auto drive on invalid metadata under a heading", () => {
    expect(cli("cook", "--mode", "prep", "--drive", "auto", "--lang", "en", ...FLAGS).code).toBe(0);
    put("research.md", "research");
    put("design.md", "design");
    put(
      "plan.md",
      "## Module: auth\nIteration: 1\n- AC-1: signs in\n## Module: product\nIteration: 2\n- AC-9 (e2e): uses the product\n",
    );
    expect(cli("order").code).toBe(0);
    expect(reviewPlan().code).toBe(0);
    cooking();
    expect(productionWrite().code).toBe(0);
    put(
      "plan.md",
      "## Module: auth\nIteration: TBD\n- AC-1: signs in\n## Module: product\nIteration: 2\n- AC-9 (e2e): uses the product\n",
    );
    const menu = cli("menu");
    expect(menu.stdout).toContain("auth: line 2: Iteration must be a positive integer");
    expect(menu.stdout).toContain("auth · planned");
    expect(menu.stdout).toContain("product · planned");
    const denied = productionWrite();
    expect(denied.code).toBe(2);
    expect(denied.stderr).toContain("VERID_BURNT_AUTO_NO_MODULE");
    const stop = run(HOOK, [], {
      hook_event_name: "Stop",
      session_id: "iterations-session",
      cwd: project,
      stop_hook_active: false,
    });
    expect(stop.code).toBe(2);
    expect(stop.stderr).toContain("Iteration must be a positive integer");
  });

  it("locks an approved module after editing only its Iteration line", () => {
    const rows = [
      { name: "off", flags: [] },
      { name: "on", flags: FLAGS },
    ];
    for (const row of rows) {
      project = join(fixture, row.name);
      mkdirSync(project);
      expect(cli("cook", "--mode", "prep", "--lang", "en", ...row.flags).code).toBe(0);
      put("research.md", "research");
      put("design.md", "design");
      put("plan.md", "## Module: auth\nIteration: 1\n- AC-1: signs in\n");
      expect(cli("order", "auth").code).toBe(0);
      cooking();
      const allowed = productionWrite();
      expect(allowed.code, allowed.stderr).toBe(0);
      put("plan.md", "## Module: auth\nIteration: 2\n- AC-1: signs in\n");
      const denied = productionWrite();
      expect(denied.code).toBe(2);
      expect(denied.stderr).toContain("VERID_BURNT_PLAN_NOT_APPROVED");
      expect(cli("menu").stdout).toContain("auth · planned");
    }
  });
});
