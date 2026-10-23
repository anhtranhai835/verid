import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLanguage } from "../../src/adapters/i18n.js";
import type { Io } from "../../src/adapters/terminal.js";
import { interactiveCook } from "../../src/cli/cook-screen.js";

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
      "Prep work",
      "Seasoning",
      "Recipe card",
    ])
      expect(t.screen()).toContain(text);
    expect(t.screen()).toContain("Light the stove");
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
    // later" is the first answer. Keys: language, mode, [drive], stove, start.
    const cases: { name: string; keys: string[] }[] = [
      { name: "prep, human", keys: [ENTER, ENTER, ENTER, ENTER, ENTER] },
      { name: "prep, auto", keys: [ENTER, ENTER, DOWN, ENTER, ENTER, ENTER] },
      { name: "recipe, auto", keys: [ENTER, DOWN, ENTER, DOWN, ENTER, ENTER, ENTER] },
      { name: "remix", keys: [ENTER, DOWN, DOWN, ENTER, ENTER, ENTER] },
    ];
    const results: Record<string, unknown> = {};
    for (const { name, keys } of cases) {
      rmSync(join(project, ".verid"), { recursive: true, force: true });
      const t = scriptedTerminal(keys);
      await interactiveCook(project, t.io, "en-US");
      results[name] = {
        asked: t.screen().includes("Who runs the kitchen?"),
        hint: t.screen().includes("stops only when stuck"),
        mode: /^mode: "(\w+)"/m.exec(manifest())?.[1],
        drive: manifest().includes('drive: "auto"') ? "auto" : "human",
      };
    }
    expect(results).toEqual({
      "prep, human": { asked: true, hint: true, mode: "prep", drive: "human" },
      "prep, auto": { asked: true, hint: true, mode: "prep", drive: "auto" },
      "recipe, auto": { asked: true, hint: true, mode: "recipe", drive: "auto" },
      remix: { asked: false, hint: false, mode: "remix", drive: "human" },
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
    // Language, mode, drive, stove, start.
    const t = scriptedTerminal([ENTER, ENTER, ENTER, ENTER, ENTER]);
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
    // Language, mode, drive, then the runner list: "Let verid find it later", "Type my own command…".
    const t = scriptedTerminal([
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
    expect(t.screen()).toContain("updated");
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
    await interactiveCook(project, scriptedTerminal([ENTER, ENTER, meanwhile]).io, "en-US");
    expect(manifest()).toBe(recipe);
  });
});
