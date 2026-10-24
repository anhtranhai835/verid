import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { setLanguage } from "../../src/adapters/i18n.js";
import type { Io } from "../../src/adapters/terminal.js";
import { interactiveCook } from "../../src/cli/cook-screen.js";
import { initCommand, planCook } from "../../src/cli/init.js";

const ENTER = "\r";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const CTRL_C = "\x03";

/**
 * A terminal that presses the next key each time verid draws a question ("? …" at the start of a
 * line, or of a redrawn list). A key may be a function: what the developer (or another program)
 * does before pressing it.
 */
function scriptedTerminal(keys: (string | (() => string))[]) {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined });
  const output = new PassThrough();
  let screen = "";
  output.on("data", (d) => {
    screen += d;
    if (/(^|\n|\x1b\[0J)\? /.test(String(d)) && keys.length > 0) {
      const next = keys.shift() as string | (() => string);
      setImmediate(() => input.write(typeof next === "function" ? next() : next));
    }
  });
  const io: Io = { input, output, color: false };
  return { io, screen: () => screen };
}

let project: string;
let agent: string | undefined;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-cook-screen-"));
  agent = process.env.CLAUDECODE; // the developer's terminal, not an agent's
  delete process.env.CLAUDECODE;
  setLanguage(null);
});
afterEach(() => {
  if (agent !== undefined) process.env.CLAUDECODE = agent;
  setLanguage(null);
  rmSync(project, { recursive: true, force: true });
});

const put = (rel: string, text = "") => {
  mkdirSync(dirname(join(project, rel)), { recursive: true });
  writeFileSync(join(project, rel), text);
};
const vitestProject = () => {
  put("package.json", '{"devDependencies":{"vitest":"^5.0.0"}}');
  put("src/app.ts");
  put("test/app.test.ts");
};
const manifest = () => readFileSync(join(project, ".verid", "manifest.yaml"), "utf8");
const state = () =>
  JSON.parse(readFileSync(join(project, ".verid", ".state", "state.json"), "utf8"));

describe("interactiveCook: verid cook in the developer's terminal", () => {
  it("asks for iterations in prep and recipe, validates the answers, and previews before writing", async () => {
    const rows = [
      { mode: ENTER, expected: "prep" },
      { mode: DOWN + ENTER, expected: "recipe" },
    ];
    for (const row of rows) {
      const terminal = scriptedTerminal([
        ENTER,
        row.mode,
        ENTER,
        DOWN + ENTER,
        "0 days\n",
        "2 weeks\n",
        "2026-02-29\n",
        "2026-10-12\n",
        "Funday\n",
        "Friday\n",
        ENTER,
        () => {
          expect(existsSync(join(project, ".verid"))).toBe(false);
          return ENTER;
        },
      ]);
      const result = await interactiveCook(project, terminal.io, "en-US");
      expect(result.exit).toBe(0);
      expect(parse(manifest())).toMatchObject({
        mode: row.expected,
        iterations: { duration: "2 weeks", start_date: "2026-10-12", demo_day: "Friday" },
      });
      expect(terminal.screen()).toContain("Plan in iterations?");
      expect(terminal.screen()).toContain("must be a positive integer followed by days or weeks");
      expect(terminal.screen()).toContain("must be a real date in YYYY-MM-DD format");
      expect(terminal.screen()).toContain("must be Monday through Sunday");
      rmSync(join(project, ".verid"), { recursive: true, force: true });
    }
  });

  it("cancels iterations setup without writing when a schedule answer is empty", async () => {
    const rows = [
      { answers: ["\n"] },
      { answers: ["2 weeks\n", "\n"] },
      { answers: ["2 weeks\n", "2026-10-12\n", "\n"] },
    ];
    for (const row of rows) {
      const terminal = scriptedTerminal([ENTER, ENTER, ENTER, DOWN + ENTER, ...row.answers]);
      const result = await interactiveCook(project, terminal.io, "en-US");
      expect(result.exit).toBe(0);
      expect(existsSync(join(project, ".verid"))).toBe(false);
      expect(terminal.screen()).toContain("Nothing was written.");
    }
  });

  it("offers manifest role upgrades once across multiple repos", async () => {
    put("api/keep.txt");
    put("web/keep.txt");
    put(
      ".verid/manifest.yaml",
      [
        "schemaVersion: 1",
        "mode: prep",
        "repos:",
        "  - path: api",
        '    source_globs: ["src/**"]',
        '    test_globs: ["tests/**"]',
        "  - path: web",
        '    source_globs: ["src/**"]',
        '    test_globs: ["tests/**"]',
      ].join("\n"),
    );
    const terminal = scriptedTerminal([ENTER, DOWN, ENTER, "n\r"]);
    await interactiveCook(project, terminal.io, "en-US");
    expect(terminal.screen().match(/\+ roles\.reviewer:/g)).toHaveLength(1);
    const plan = await planCook(project, { src: [], tests: [], dryRun: true });
    expect(plan.notes.join("\n").match(/\+ roles\.reviewer:/g)).toHaveLength(1);
    expect(plan.notes.join("\n")).not.toMatch(/(?:api|web):.*roles\./);
  });
  it("recognizes code and runners in workspace repos and finishes with workspace commit instructions", async () => {
    put("api/src/app.ts");
    put("api/package.json", '{"devDependencies":{"vitest":"1"}}');
    const git = spawnSync("git", ["init", "-q", "-b", "main"], {
      cwd: join(project, "api"),
      encoding: "utf8",
    });
    expect(git.status, git.stderr).toBe(0);
    const committed = spawnSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "initial fixture",
      ],
      {
        cwd: join(project, "api"),
        encoding: "utf8",
      },
    );
    expect(committed.status, committed.stderr).toBe(0);
    const terminal = scriptedTerminal([ENTER, ENTER, ENTER, ENTER, ENTER]);
    const result = await interactiveCook(project, terminal.io, "en-US");
    expect(result.exit).toBe(0);
    expect(parse(manifest()).mode).toBe("remix");
    expect(parse(manifest()).layout).toBe("workspace");
    expect(terminal.screen()).toContain("vitest (api)");
    expect(terminal.screen()).toContain("git -C .verid");
  });
  it("shows the file tree before Apply and accepts y or n without writing on n", async () => {
    const rows = [
      { answer: "n\r", applied: false },
      { answer: "y\r", applied: true },
    ];
    for (const { answer, applied } of rows) {
      vitestProject();
      let beforeApply = "";
      const terminal = scriptedTerminal([
        ENTER,
        ENTER,
        () => {
          beforeApply = terminal.screen();
          expect(existsSync(join(project, ".verid"))).toBe(false);
          return answer;
        },
      ]);
      const r = await interactiveCook(project, terminal.io, "en-US");
      expect(r.exit).toBe(0);
      expect(beforeApply).toContain("Apply? (Y/n)");
      expect(beforeApply).toContain("+ tip.md");
      expect(existsSync(join(project, ".verid"))).toBe(applied);
    }
  });

  it("previews flagged setup and asks Apply before any write in a terminal", async () => {
    const rows = [
      { answer: "n\n", applied: false },
      { answer: "\n", applied: true },
    ];
    for (const { answer, applied } of rows) {
      const terminal = scriptedTerminal([
        () => {
          expect(existsSync(join(project, ".verid"))).toBe(false);
          return answer;
        },
      ]);
      const r = await initCommand(project, { mode: "prep", src: [], tests: [] }, terminal.io);
      expect(r.exit).toBe(0);
      expect(terminal.screen()).toContain("Apply? (Y/n)");
      expect(terminal.screen()).toContain("+ manifest.yaml");
      expect(existsSync(join(project, ".verid"))).toBe(applied);
    }
  });

  it("keeps settings edited while the developer confirms flagged setup", async () => {
    const terminal = scriptedTerminal([
      () => {
        put(".claude/settings.local.json", '{"env":{"MY_SETTING":"keep"}}');
        return "\n";
      },
      "\n",
    ]);
    const r = await initCommand(project, { mode: "prep", src: [], tests: [] }, terminal.io);
    expect(r.exit).toBe(0);
    expect(
      JSON.parse(readFileSync(join(project, ".claude/settings.local.json"), "utf8")).env,
    ).toEqual({ MY_SETTING: "keep" });
  });

  it("shows each file only in the tree before the interactive Apply question", async () => {
    vitestProject();
    const terminal = scriptedTerminal([ENTER, ENTER, "n\r"]);
    await interactiveCook(project, terminal.io, "en-US");
    expect(terminal.screen().match(/settings\.local\.json/g)).toHaveLength(1);
  });

  it("shows a changed plan and asks again before applying flagged cook or upgrade", async () => {
    const rows = [{ command: "cook" }, { command: "upgrade" }] as const;
    for (const { command } of rows) {
      rmSync(project, { recursive: true, force: true });
      mkdirSync(project);
      if (command === "upgrade")
        await initCommand(
          project,
          { mode: "prep", src: [], tests: [], yes: true },
          scriptedTerminal([]).io,
        );
      const terminal = scriptedTerminal([
        () => {
          put(".claude/settings.local.json", '{"env":{"MY_SETTING":"changed"}}');
          return "\n";
        },
        "n\n",
      ]);
      const r = await initCommand(
        project,
        { mode: "prep", src: [], tests: [] },
        terminal.io,
        command,
      );
      expect(r.exit).toBe(0);
      expect(terminal.screen().match(/Apply\? \(Y\/n\)/g)).toHaveLength(2);
      expect(terminal.screen()).toContain("~ settings.local.json");
      expect(r.stdout).toContain("Nothing was written.");
      expect(
        JSON.parse(readFileSync(join(project, ".claude/settings.local.json"), "utf8")),
      ).toEqual({ env: { MY_SETTING: "changed" } });
      expect(existsSync(join(project, ".verid"))).toBe(command === "upgrade");
    }
  });

  it("asks again when contents change even if the planned actions stay the same", async () => {
    put(".claude/settings.local.json", '{"env":{"MY_SETTING":"before"}}');
    const terminal = scriptedTerminal([
      () => {
        put(".claude/settings.local.json", '{"env":{"MY_SETTING":"after"}}');
        return "\n";
      },
      "n\n",
    ]);
    const r = await initCommand(project, { mode: "prep", src: [], tests: [] }, terminal.io);
    expect(terminal.screen().match(/Apply\? \(Y\/n\)/g)).toHaveLength(2);
    expect(r.stdout).toContain("Nothing was written.");
    expect(existsSync(join(project, ".verid"))).toBe(false);
  });

  it("shows the fresh interactive plan and lets the developer cancel it", async () => {
    vitestProject();
    const terminal = scriptedTerminal([
      ENTER,
      ENTER,
      () => {
        put(".claude/settings.local.json", '{"env":{"MY_SETTING":"changed"}}');
        return ENTER;
      },
      "n\r",
    ]);
    await interactiveCook(project, terminal.io, "en-US");
    expect(terminal.screen().match(/Apply\? \(Y\/n\)/g)).toHaveLength(2);
    expect(terminal.screen()).toContain("~ settings.local.json");
    expect(existsSync(join(project, ".verid"))).toBe(false);
  });

  it("applies the fresh plan without a question with --yes", async () => {
    const terminal = scriptedTerminal([]);
    const original = terminal.io.output.write.bind(terminal.io.output);
    let edited = false;
    const write = vi.spyOn(terminal.io.output, "write").mockImplementation((...args) => {
      if (!edited) {
        edited = true;
        put(".claude/settings.local.json", '{"env":{"MY_SETTING":"keep"}}');
      }
      return original(...args);
    });
    try {
      const r = await initCommand(
        project,
        { mode: "prep", src: [], tests: [], yes: true },
        terminal.io,
      );
      expect(r.exit).toBe(0);
      expect(
        JSON.parse(readFileSync(join(project, ".claude/settings.local.json"), "utf8")).env,
      ).toEqual({ MY_SETTING: "keep" });
      expect(terminal.screen()).not.toContain("Apply?");
    } finally {
      write.mockRestore();
    }
  });

  it("ignores edits to kept files and unrelated state fields when comparing plans", async () => {
    await initCommand(
      project,
      { mode: "prep", lang: "en", src: [], tests: [], yes: true },
      scriptedTerminal([]).io,
    );
    const rows = [
      {
        rel: ".verid/.state/state.json",
        text: '{"schemaVersion":1,"language":"en","counters":{"blocked_actions":1}}',
        lang: "en",
        action: "kept",
      },
      {
        rel: ".verid/.gitignore",
        text: ".state/\n# keep this\nplugins/\n",
        lang: "en",
        action: "kept",
      },
      {
        rel: ".verid/manifest.yaml",
        text: `${manifest()}\n# keep this\n`,
        lang: "en",
        action: "kept",
      },
      {
        rel: ".claude/commands/verid/tip.md",
        text: "Developer's own tip\n",
        lang: "en",
        action: "kept",
      },
      {
        rel: ".verid/.state/state.json",
        text: '{"schemaVersion":1,"language":"en","counters":{"blocked_actions":2}}',
        lang: "vi",
        action: "updated",
      },
    ];
    for (const { rel, text, lang, action } of rows) {
      const flags = { src: [], tests: [], lang };
      const before = await planCook(project, flags);
      put(rel, text);
      const after = await planCook(project, flags);
      expect(after.files.find((file) => file.rel === rel)?.action, rel).toBe(action);
      expect(after.revision, rel).toBe(before.revision);
    }
  });

  it("compares the contents it would write even when file actions stay the same", async () => {
    const english = await planCook(project, { mode: "prep", lang: "en", src: [], tests: [] });
    const vietnamese = await planCook(project, { mode: "prep", lang: "vi", src: [], tests: [] });
    expect(english.files).toEqual(vietnamese.files);
    expect(english.notes).toEqual(vietnamese.notes);
    expect(english.revision).not.toBe(vietnamese.revision);
  });

  it("refuses after three changing plans with --yes without applying cook or upgrade", async () => {
    const rows = [{ command: "cook" }, { command: "upgrade" }] as const;
    for (const { command } of rows) {
      rmSync(project, { recursive: true, force: true });
      mkdirSync(project);
      if (command === "upgrade")
        await initCommand(
          project,
          { mode: "prep", src: [], tests: [], yes: true },
          scriptedTerminal([]).io,
        );
      const terminal = scriptedTerminal([]);
      const original = terminal.io.output.write.bind(terminal.io.output);
      let previews = 0;
      const write = vi.spyOn(terminal.io.output, "write").mockImplementation((...args) => {
        if (String(args[0]).startsWith(`verid ${command} (`)) {
          previews++;
          // Finite churn makes an unbounded implementation fail without hanging the test.
          if (previews <= 5)
            put(".claude/settings.local.json", JSON.stringify({ env: { EDIT: String(previews) } }));
        }
        return original(...args);
      });
      try {
        await expect(
          initCommand(
            project,
            { mode: "prep", src: [], tests: [], yes: true },
            terminal.io,
            command,
          ),
        ).rejects.toMatchObject({ code: "VERID_BURNT_INIT_UNSTABLE" });
        expect(previews).toBe(3);
        expect(existsSync(join(project, ".verid/manifest.yaml"))).toBe(command === "upgrade");
        expect(
          JSON.parse(readFileSync(join(project, ".claude/settings.local.json"), "utf8")),
        ).toEqual({
          env: { EDIT: "3" },
        });
      } finally {
        write.mockRestore();
      }
    }
  });

  it("sets up a recognised project with Enter alone: language, mode, start", async () => {
    vitestProject();
    const t = scriptedTerminal([ENTER, ENTER, ENTER]);
    const r = await interactiveCook(project, t.io, "en-US");
    expect(r.exit).toBe(0);
    expect(manifest()).toContain('mode: "remix"');
    expect(manifest()).toContain('source_globs: ["**"]');
    expect(state().language).toBe("en");
    expect(existsSync(join(project, ".claude", "settings.local.json"))).toBe(true);
    for (const text of [
      "╚═══╝",
      "Test runner: verid finds it at each",
      "vitest",
      "+ state.json",
      "+ .gitignore",
      "+ manifest.yaml",
    ])
      expect(t.screen()).toContain(text);
    expect(t.screen()).toContain("+ settings.local.json");
    // What to commit and what not, a line each: the same reminder as with flags.
    expect(t.screen()).toContain("✅ verid is set up for this project and this machine.");
    expect(t.screen()).toMatch(
      /📌 Commit: +\.verid\/manifest\.yaml {2}\.verid\/\.gitignore {2}\.claude\/commands\/verid\//,
    );
    expect(t.screen()).toMatch(/🚫 Do not commit: +\.claude\/settings\.local\.json/);
    // remix: the baseline comes before the agent.
    expect(t.screen()).toMatch(/🍽️ {2}Served! First run `.+ stock` here/);
  });

  it("says what it locks before writing anything, with examples from the project", async () => {
    vitestProject();
    put("src/main/java/App.java");
    put("README.md");
    let writtenBeforeStart = true;
    const start = () => {
      writtenBeforeStart = existsSync(join(project, ".verid"));
      return ENTER;
    };
    const t = scriptedTerminal([ENTER, ENTER, start]);
    await interactiveCook(project, t.io, "en-US");
    expect(writtenBeforeStart).toBe(false);
    expect(t.screen()).toContain(
      "🔒 Locked until a test fails: every code file that is not a test",
    );
    expect(t.screen()).toContain("e.g. src/app.ts, src/main/java/App.java");
    expect(t.screen()).toContain("🧪 Counted as tests:");
    expect(t.screen()).toContain("e.g. test/app.test.ts");
    expect(t.screen()).toContain("📄 Not locked: documents, data and config");
    expect(t.screen()).not.toContain("README.md");
    expect(t.screen()).not.toContain("glob");
  });

  it("asks who runs the kitchen after prep and recipe, writes the pick, and skips it for remix", async () => {
    // An empty folder sees no runner, so each run also asks about the stove: "Let verid find it
    // later" is the first answer. Keys: language, mode, [drive, iterations], stove, start.
    const cases: { name: string; keys: string[] }[] = [
      { name: "prep, human", keys: [ENTER, ENTER, ENTER, ENTER, ENTER, ENTER] },
      { name: "prep, auto", keys: [ENTER, ENTER, DOWN, ENTER, ENTER, ENTER, ENTER] },
      { name: "recipe, auto", keys: [ENTER, DOWN, ENTER, DOWN, ENTER, ENTER, ENTER, ENTER] },
      { name: "remix", keys: [ENTER, DOWN, DOWN, ENTER, ENTER, ENTER] },
    ];
    const results: Record<string, unknown> = {};
    for (const { name, keys } of cases) {
      rmSync(join(project, ".verid"), { recursive: true, force: true });
      const t = scriptedTerminal(keys);
      await interactiveCook(project, t.io, "en-US");
      results[name] = {
        asked: t.screen().includes("Who runs the kitchen?"),
        iterations: t.screen().includes("Plan in iterations?"),
        hint: t.screen().includes("stops only when stuck"),
        mode: /^mode: "(\w+)"/m.exec(manifest())?.[1],
        drive: manifest().includes('drive: "auto"') ? "auto" : "human",
      };
    }
    expect(results).toEqual({
      "prep, human": { asked: true, iterations: true, hint: true, mode: "prep", drive: "human" },
      "prep, auto": { asked: true, iterations: true, hint: true, mode: "prep", drive: "auto" },
      "recipe, auto": { asked: true, iterations: true, hint: true, mode: "recipe", drive: "auto" },
      remix: { asked: false, iterations: false, hint: false, mode: "remix", drive: "human" },
    });
  });

  it("writes nothing when the developer cancels", async () => {
    vitestProject();
    const t = scriptedTerminal([ENTER, CTRL_C]);
    const r = await interactiveCook(project, t.io, "en-US");
    expect(r.exit).toBe(0);
    expect(existsSync(join(project, ".verid"))).toBe(false);
    expect(t.screen().trimEnd().endsWith("Nothing was written.")).toBe(true);
  });

  it("asks a teammate's clone only the language, then cooks in it", async () => {
    vitestProject();
    await interactiveCook(project, scriptedTerminal([ENTER, ENTER, ENTER]).io, "en-US");
    rmSync(join(project, ".verid", ".state"), { recursive: true }); // a fresh clone
    const t = scriptedTerminal([UP, ENTER, ENTER]); // English is first offered; up is Tiếng Việt
    await interactiveCook(project, t.io, "en-US");
    expect(state().language).toBe("vi");
    expect(t.screen()).not.toContain("remix");
    expect(t.screen()).toContain("Xong!");
  });

  it("leaves the runner to verid when it sees none, and locks code written later in an empty folder", async () => {
    // Language, mode, drive, iterations, stove, start.
    const t = scriptedTerminal([ENTER, ENTER, ENTER, ENTER, ENTER, ENTER]);
    await interactiveCook(project, t.io, "en-US");
    expect(manifest()).toContain('mode: "prep"');
    expect(manifest()).toContain("# test_cmd: verid finds the test runner");
    expect(t.screen()).toContain("Let verid find it later");
    expect(manifest()).toContain('source_globs: ["**"]');
    expect(t.screen()).toContain("none yet; files written later follow the same rule");
  });

  it("unlocks folders by number or name, and can lock one again", async () => {
    vitestProject();
    put("examples/demo.ts");
    put("scripts/run.sh");
    // Start, Unlock a folder…, Cancel. The folders: 1. examples/, 2. scripts/, 3. src/.
    const t = scriptedTerminal([
      ENTER,
      ENTER,
      DOWN,
      ENTER,
      "1, 2, tools\n",
      DOWN,
      ENTER,
      "2\n",
      ENTER,
    ]);
    await interactiveCook(project, t.io, "en-US");
    expect(t.screen()).toContain("◉ 1. examples/");
    expect(t.screen()).toContain("◯ 1. examples/");
    expect(t.screen()).toContain("📄 You unlocked: examples/, scripts/, tools/");
    expect(manifest()).toMatch(/"\*\*\/__pycache__\/\*\*","examples\/\*\*","tools\/\*\*"\]/);
  });

  it("asks again for a number not in the list or a name it cannot use, Enter keeping them", async () => {
    vitestProject();
    const t = scriptedTerminal([ENTER, ENTER, DOWN, ENTER, "7\n", "/abs/**\n", "\n", ENTER]);
    await interactiveCook(project, t.io, "en-US");
    expect(t.screen()).toContain("There is no 7 in the list (1–1)");
    expect(t.screen()).toContain("/abs/** will not work: only **, * and ? are supported");
    expect(manifest()).toMatch(/"\*\*\/__pycache__\/\*\*"\]/);
  });

  it("asks again for a command it cannot use, saying what it needs", async () => {
    // Language, mode, drive, iterations, then "Let verid find it later", "Type my own command…".
    const t = scriptedTerminal([
      ENTER,
      ENTER,
      ENTER,
      ENTER,
      DOWN,
      ENTER,
      "npm test\n",
      "npx jest --outputFile={junit}\n",
      ENTER,
    ]);
    await interactiveCook(project, t.io, "en-US");
    expect(t.screen()).toContain("{junit}");
    expect(manifest()).toContain("npx jest --outputFile={junit}");
  });

  it("adds the new defaults to an older manifest once the developer says so", async () => {
    vitestProject();
    put(
      ".verid/manifest.yaml",
      [
        "# verid manifest: only the developer edits this file. Commit it with the project.",
        "schemaVersion: 1",
        'mode: "remix" # prep | recipe | remix',
        "repos:",
        '  - path: "."',
        '    test_cmd: "npx vitest run --reporter=junit --outputFile={junit}"',
        '    source_globs: ["**"]',
        '    test_globs: ["**/test/**","**/*.test.*"]',
        '    ignore_globs: ["**/*.md","**/*.json","examples/**"]',
        "",
      ].join("\n"),
    );
    const t = scriptedTerminal([ENTER, ENTER, ENTER]); // English, add them, start
    await interactiveCook(project, t.io, "en-US");
    // The changes a line per key, and a question short enough to read.
    const lines = t.screen().split("\n");
    expect(lines.filter((l) => l.startsWith("  + ignore_globs: "))[0]).toContain('"**/go.mod"');
    expect(lines.filter((l) => l.startsWith("  + test_globs: "))).toHaveLength(1);
    expect(lines).toContain("  − test_cmd");
    expect(lines.filter((l) => l.startsWith("? ") && l.includes("**/"))).toEqual([]);
    expect(manifest()).toContain("**/go.mod");
    expect(manifest()).toContain("examples/**");
    expect(manifest()).not.toMatch(/^ +test_cmd:/m);
    expect(t.screen()).toContain("~ manifest.yaml");
  });

  it("offers optional roles to an existing mapping and applies only the developer's choice", async () => {
    const rows = [
      {
        answer: [ENTER],
        want: {
          reviewer: ["custom:reviewer"],
          researcher: ["custom:researcher"],
          architect: ["verid:architect"],
          planner: ["verid:planner"],
          qa: ["verid:qa"],
        },
        installNote: true,
      },
      {
        answer: [DOWN, ENTER],
        want: {
          reviewer: ["custom:reviewer"],
          researcher: ["custom:researcher"],
        },
        installNote: false,
      },
    ];
    for (const { answer, want, installNote } of rows) {
      put(
        ".verid/manifest.yaml",
        [
          "schemaVersion: 1",
          "mode: prep",
          "roles:",
          '  reviewer: ["custom:reviewer"] # my reviewer',
          '  researcher: ["custom:researcher"]',
          "repos:",
          '  - path: "."',
          '    source_globs: ["**"]',
          '    test_globs: ["test/**"]',
          "",
        ].join("\n"),
      );
      const terminal = scriptedTerminal([ENTER, ...answer, ENTER]);
      await interactiveCook(project, terminal.io, "en-US");
      expect(parse(manifest()).roles).toEqual(want);
      expect(manifest()).toContain("# my reviewer");
      expect(terminal.screen().includes("claude plugin install verid@verid")).toBe(installNote);
    }
  });

  it("checks again when it starts cooking: a file written while it waited is kept", async () => {
    vitestProject();
    const recipe = [
      "schemaVersion: 1",
      'mode: "recipe"',
      "repos:",
      '  - path: "."',
      '    test_cmd: "npx vitest run --reporter=junit --outputFile={junit}"',
      '    source_globs: ["src/**"]',
      '    test_globs: ["test/**"]',
      "",
    ].join("\n");
    const meanwhile = () => {
      mkdirSync(join(project, ".verid"), { recursive: true });
      writeFileSync(join(project, ".verid", "manifest.yaml"), recipe);
      return ENTER;
    };
    await interactiveCook(project, scriptedTerminal([ENTER, ENTER, meanwhile, ENTER]).io, "en-US");
    expect(manifest()).toBe(recipe);
  });
});
