import { tempProject, CLI, HOOK } from "../support/project.js";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { claudeFixture } from "./helpers.js";

// How a developer tells verid about a project it does not recognise: the test command is all it
// needs. The runner is not installed yet, so verid taste finds no report; nothing here touches
// the network.
const NO_RUNNER = ["--test-cmd", "node no-runner-yet.js {junit}"];
const LOCAL = ".claude/settings.local.json";
const OLD_MANIFEST = [
  "# verid manifest: only the developer edits this file. Commit it with the project.",
  "schemaVersion: 1",
  'mode: "remix" # prep | recipe | remix',
  "repos:",
  '  - path: "."',
  '    test_cmd: "npx vitest run --reporter=junit --outputFile={junit}"',
  '    source_globs: ["**"]',
  '    test_globs: ["**/test/**","**/*.test.*"]',
  '    ignore_globs: ["**/*.md","**/*.json"]',
  "",
].join("\n");

let project: string;

const t = tempProject("verid-init-", {
  claudeProject: false,
  cwd: () => project,
  bind: (p) => {
    project = p.root;
  },
});
const {
  newDir: newProject,
  env: cleanEnv,
  spawnCook: init,
  spawnCookWith: initWith,
  spawnCliAt: cli,
} = t;
const { readAt: read, putAt: put, settingsHook: hook } = t;

const file = (dir: string, rel: string) => join(dir, ...rel.split("/"));

const json = (dir: string, rel: string) => JSON.parse(read(dir, rel));

const payload = claudeFixture;
const writeTo = (dir: string, rel: string) =>
  payload(dir, "pre-tool-use-write", (p) => (p.tool_input.file_path = file(dir, rel)));
// cook maps verid's tester and coder, so each part is written by its subagent (agent_id set).
const writeAs = (dir: string, rel: string, agent: string) =>
  payload(dir, "pre-tool-use-write", (p) => {
    p.tool_input.file_path = file(dir, rel);
    p.agent_id = "a1b2c3";
    p.agent_type = agent;
  });

const vitestProject = (dir: string) => {
  put(dir, "package.json", JSON.stringify({ devDependencies: { vitest: "^5.0.0" } }));
  mkdirSync(file(dir, "src"));
  mkdirSync(file(dir, "test"));
};

describe("verid cook", () => {
  it("mentions only mapped optional agents in the installation note", () => {
    const rows = [
      [
        [
          "roles:",
          '  reviewer: ["verid:reviewer"]',
          '  tester: ["verid:tester"]',
          '  coder: ["verid:coder"]',
        ],
        "(verid:tester, verid:coder, verid:reviewer)",
        [],
      ],
      [
        ["roles:", '  reviewer: ["verid:reviewer"]', '  qa: ["custom:qa"]'],
        "(verid:reviewer, custom:qa)",
        ["qa"],
      ],
      [["roles:", '  planner: ["verid:planner"]'], "(verid:planner)", ["planner"]],
    ] as const;
    const got = rows.map(([roles, agents]) => {
      const dir = newProject();
      put(dir, ".verid/manifest.yaml", OLD_MANIFEST + roles.join("\n") + "\n");
      const result = init(dir, "--lang", "en");
      const note = result.stdout.split("\n").find((line) => line.startsWith("! Roles: ")) ?? "";
      return [
        result.code,
        note.includes(agents),
        [...new Set(note.match(/\b(?:architect|planner|qa)\b/g) ?? [])],
      ];
    });
    expect(got).toEqual(rows.map(([, , roles]) => [0, true, roles]));
  });

  it("rejects the retired researcher mapping without rewriting the project", () => {
    const raw = OLD_MANIFEST + 'roles:\n  researcher: ["custom:research"]\n';
    put(project, ".verid/manifest.yaml", raw);
    const result = init(project, "--yes");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("roles.researcher");
    expect(result.stderr).toContain("remove");
    expect(result.stderr).toContain("verid cook");
    expect(result.stderr).toContain("verid:ba");
    expect(read(project, ".verid/manifest.yaml")).toBe(raw);
    expect(existsSync(file(project, ".claude/settings.local.json"))).toBe(false);
  });

  it("maps every plugin role so the agents meet their hook restrictions", () => {
    expect(init(project, "--mode", "prep", ...NO_RUNNER).code).toBe(0);
    expect(parse(read(project, ".verid/manifest.yaml")).roles).toEqual({
      reviewer: ["verid:reviewer"],
      tester: ["verid:tester"],
      coder: ["verid:coder"],
      architect: ["verid:architect"],
      planner: ["verid:planner"],
      qa: ["verid:qa"],
      security: ["verid:security"],
    });
    expect(parse(read(project, ".verid/manifest.yaml")).allowed_agents).toEqual([]);
    const rows = [
      ["verid:architect", ".verid/design.md", 0, ""],
      ["verid:architect", "notes.md", 0, ""],
      ["verid:planner", "notes.md", 0, ""],
      ["verid:qa", "test/unit.test.ts", 2, "VERID_BURNT_TASK_SESSION"],
      ["verid:qa", "e2e/login.spec.ts", 2, "VERID_BURNT_TASK_SESSION"],
      ["verid:security", "notes.md", 2, "VERID_BURNT_ROLE_READ_ONLY"],
    ] as const;
    for (const [agent, rel, code, message] of rows) {
      const result = hook(project, "PreToolUse", writeAs(project, rel, agent));
      expect(result.code, `${agent} ${rel}`).toBe(code);
      if (message) expect(result.stderr).toContain(message);
    }
  });
  // By default each picks up the other's test files.
  it("says how to split vitest and Playwright when a project has both, and nothing otherwise", () => {
    const both = newProject();
    const deps = { vitest: "^5.0.0", "@playwright/test": "^1.0.0" };
    put(both, "package.json", JSON.stringify({ devDependencies: deps }));
    const told = init(both, "--mode", "prep");
    expect(told.stdout).toContain('testDir: "e2e"');
    expect(told.stdout).toContain("e2e/**");
    vitestProject(project);
    expect(init(project, "--mode", "prep").stdout).not.toContain('testDir: "e2e"');
  });

  it("sets up a vitest project in one command, with the TDD gate on", () => {
    vitestProject(project);
    const r = init(project, "--mode", "remix");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    for (const line of ["+ state.json", "+ .gitignore", "+ manifest.yaml", "+ settings.local.json"])
      expect(r.stdout).toContain(line);

    expect(json(project, ".verid/.state/state.json").schemaVersion).toBe(1);
    expect(read(project, ".verid/.gitignore")).toBe(".state/\n");
    // No test_cmd: verid finds the runner at each run, and says which one it sees now.
    expect(read(project, ".verid/manifest.yaml")).toContain("# test_cmd: verid finds");
    expect(r.stdout).toMatch(/test runner.*vitest/i);
    const pre = json(project, LOCAL).hooks.PreToolUse;
    expect(pre).toEqual([
      {
        matcher: "*",
        hooks: [
          { type: "command", command: "node", args: [HOOK], timeout: 10, onFailure: "block" },
        ],
      },
    ]);
    expect(Object.keys(json(project, LOCAL).hooks).sort()).toEqual([
      "PreToolUse",
      "SessionStart",
      "Stop",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);

    const denied = hook(project, "PreToolUse", writeAs(project, "src/a.ts", "verid:coder"));
    expect(denied.code).toBe(2);
    expect(denied.stderr).toContain("verid [VERID_BURNT_TDD_NO_FAILING_TEST]");
    const test = writeAs(project, "test/a.test.ts", "verid:tester");
    expect(hook(project, "PreToolUse", test).code).toBe(0);
  });

  it("adds verid's commands to Claude Code's menu in this machine's language, keeping any there", () => {
    vitestProject(project);
    const r = init(project, "--mode", "remix", "--lang", "vi");
    expect(r.stdout).toContain("+ tip.md");
    const dir = file(project, ".claude/commands/verid");
    expect(readdirSync(dir).sort()).toEqual(["confirm.md", "menu.md", "peek.md", "tip.md"]);
    expect(read(project, ".claude/commands/verid/tip.md")).toMatch(
      /^---\ndescription: "Xin vượt .+"\nargument-hint: "<lý do>"\ndisable-model-invocation: true\n---\n.+\n$/,
    );
    expect(read(project, ".claude/commands/verid/menu.md")).not.toContain("argument-hint");
    // A file that is there may be the developer's own edit, or a teammate's in another language.
    put(project, ".claude/commands/verid/menu.md", "mine\n");
    rmSync(file(project, ".claude/commands/verid/peek.md"));
    expect(init(project, "--lang", "en").stdout).toContain("+ peek.md");
    expect(read(project, ".claude/commands/verid/menu.md")).toBe("mine\n");
    expect(read(project, ".claude/commands/verid/peek.md")).toContain('description: "Show ');
    expect(init(project).stdout).toContain("= tip.md");
  });

  it("refuses a language other than vi or en, writing nothing", () => {
    vitestProject(project);
    const r = init(project, "--mode", "remix", "--lang", "xx");
    expect([r.code, r.stderr.includes("verid [VERID_BURNT_INIT_INVALID]")]).toEqual([2, true]);
    expect(existsSync(file(project, ".verid"))).toBe(false);
  });

  it("keeps the language chosen with --lang, and every later message comes in it alone", () => {
    vitestProject(project);
    expect(init(project, "--mode", "remix", "--lang", "vi").code).toBe(0);
    expect(json(project, ".verid/.state/state.json").language).toBe("vi");
    const prefixed = /^(vi|en): /m;
    const peek = cli(project, "peek").stdout;
    const denied = hook(project, "PreToolUse", writeAs(project, "src/a.ts", "verid:coder")).stderr;
    const start = hook(project, "SessionStart", payload(project, "session-start")).stdout;
    expect({
      peek: [peek.includes("code production đang bị khoá"), prefixed.test(peek)],
      deny: [denied.includes("Code production đang bị khoá"), prefixed.test(denied)],
      start: [start.includes("Trạng thái, câu hỏi và audit đầy đủ"), prefixed.test(start)],
    }).toEqual({ peek: [true, false], deny: [true, false], start: [true, false] });
  });

  it("records the system locale's language when cook gets no --lang, so later messages come in one", () => {
    const rows = [
      ["vi_VN.UTF-8", "vi"],
      ["en_US.UTF-8", "en"],
      ["fr_FR.UTF-8", "en"],
    ] as const;
    const got: Record<string, unknown> = {};
    vitestProject(project);
    for (const [locale] of rows) {
      rmSync(file(project, ".verid"), { recursive: true, force: true });
      const r = initWith({ ...cleanEnv(), LC_ALL: locale }, project, "--mode", "remix");
      expect(r.code, r.stderr).toBe(0);
      got[locale] = json(project, ".verid/.state/state.json").language;
    }
    expect(got).toEqual(Object.fromEntries(rows));
  });

  it("lets the developer change the language with another verid cook", () => {
    vitestProject(project);
    expect(init(project, "--mode", "remix", "--lang", "vi").code).toBe(0);
    const again = init(project, "--lang", "en");
    expect(again.stdout).toContain("~ state.json");
    const peek = cli(project, "peek").stdout;
    expect([peek.includes("RAW: production code is locked"), /^(vi|en): /m.test(peek)]).toEqual([
      true,
      false,
    ]);
  });

  it("is idempotent and keeps the developer's own settings", () => {
    vitestProject(project);
    const lint = { matcher: "Bash", hooks: [{ type: "command", command: "lint.sh" }] };
    put(
      project,
      LOCAL,
      JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: { PreToolUse: [lint] } }),
    );
    expect(init(project, "--mode", "remix").code).toBe(0);
    const first = read(project, LOCAL);
    const again = init(project);
    expect(again.code).toBe(0);
    for (const line of ["= state.json", "= .gitignore", "= manifest.yaml", "= settings.local.json"])
      expect(again.stdout).toContain(line);
    expect(read(project, LOCAL)).toBe(first);
    const settings = JSON.parse(first);
    expect(settings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(settings.hooks.PreToolUse[0]).toEqual(lint);
    expect(settings.hooks.PreToolUse).toHaveLength(2);
  });

  it("points the hooks at this verid when an older one was registered", () => {
    vitestProject(project);
    const old = { type: "command", command: "node", args: ["C:/tools/verid/dist/hook.js"] };
    put(
      project,
      LOCAL,
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "*", hooks: [old] }], Stop: [{ hooks: [old] }] },
      }),
    );
    const r = init(project, "--mode", "remix");
    expect(r.stdout).toContain("~ settings.local.json");
    expect(read(project, LOCAL)).not.toContain("C:/tools/verid");
  });

  it("gives a fresh clone the manifest, and its own hooks once that machine runs verid cook", () => {
    vitestProject(project);
    expect(init(project, "--mode", "remix").code).toBe(0);
    // What a teammate gets from git: committed files only.
    const clone = newProject();
    vitestProject(clone);
    for (const rel of [".verid/manifest.yaml", ".verid/.gitignore"])
      cpSync(file(project, rel), file(clone, rel), { recursive: true });

    const r = init(clone);
    expect(r.stdout).toContain("= manifest.yaml");
    expect(r.stdout).toContain("+ state.json");
    expect(r.stdout).toContain("+ settings.local.json");
    expect(hook(clone, "PreToolUse", writeAs(clone, "test/a.test.ts", "verid:tester")).code).toBe(
      0,
    );
    expect(hook(clone, "PreToolUse", writeAs(clone, "src/a.ts", "verid:coder")).code).toBe(2);
  });

  it("sets up a project whose runner it cannot see yet, and takes a test command it is told", () => {
    const r = init(project, "--mode", "remix");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("+ manifest.yaml");
    expect(r.stdout).toContain("package.json, pyproject.toml, pom.xml");
    expect(read(project, ".verid/manifest.yaml")).not.toMatch(/^ +test_cmd:/m);

    rmSync(file(project, ".verid"), { recursive: true });
    const told = init(project, "--mode", "remix", "--test-cmd", "make test JUNIT={junit}");
    expect(told.code).toBe(0);
    expect(told.stdout).toContain("+ manifest.yaml");
    expect(read(project, ".verid/manifest.yaml")).toContain('test_cmd: "make test JUNIT={junit}"');
    expect(read(project, ".verid/manifest.yaml")).toContain('source_globs: ["**"]');
  });

  it("lists the new defaults an older manifest lacks, and writes nothing without a terminal", () => {
    vitestProject(project);
    mkdirSync(file(project, ".verid"), { recursive: true });
    writeFileSync(file(project, ".verid/manifest.yaml"), OLD_MANIFEST);
    const r = init(project);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("= manifest.yaml");
    for (const glob of ["**/vite.config.*", "**/.*", "**/go.mod"]) expect(r.stdout).toContain(glob);
    expect(read(project, ".verid/manifest.yaml")).toBe(OLD_MANIFEST);
  });

  // With no language chosen yet, the explanation comes in both and the list, language-free, once.
  it("lists an older manifest's changes once, a line per key, under the explanation", () => {
    vitestProject(project);
    mkdirSync(file(project, ".verid"), { recursive: true });
    writeFileSync(file(project, ".verid/manifest.yaml"), OLD_MANIFEST);
    const lines = init(project)
      .stdout.split("\n")
      .map((line) => line.replace(/^! /, ""));
    const at = (start: string) => lines.filter((l) => l.startsWith(start));
    expect({
      tests: at("  + test_globs: ").map((l) => l.includes('"**/vite.config.*"')),
      ignore: at("  + ignore_globs: ").map((l) => l.includes('"**/go.mod"')),
      e2e: at("  + e2e_globs: ").length,
      roles: at("  + roles."),
      test_cmd: at("  − test_cmd"),
      "explained in": at("vi: Manifest này").length + at("en: This manifest").length,
    }).toEqual({
      tests: [true],
      ignore: [true],
      e2e: 1,
      roles: [
        '  + roles.reviewer: ["verid:reviewer"]',
        '  + roles.tester: ["verid:tester"]',
        '  + roles.coder: ["verid:coder"]',
        '  + roles.architect: ["verid:architect"]',
        '  + roles.planner: ["verid:planner"]',
        '  + roles.qa: ["verid:qa"]',
        '  + roles.security: ["verid:security"]',
      ],
      test_cmd: [], // the developer's test_cmd stays
      "explained in": 2,
    });
  });

  // In remix the developer records the baseline before the agent can run a test.
  it("ends with the next step, as the screen in a terminal does", () => {
    const last = (mode: string) => {
      const dir = newProject();
      vitestProject(dir);
      return init(dir, "--mode", mode, "--lang", "en").stdout.trimEnd().split("\n").at(-1) ?? "";
    };
    const remix = last("remix");
    const prep = last("prep");
    expect({
      remix: [remix.includes('cli.js" stock`'), remix.includes("Then open Claude Code")],
      prep: [prep.includes("stock"), prep.includes("Open Claude Code and say what you want.")],
    }).toEqual({ remix: [true, true], prep: [false, true] });
  });

  it("forgets, when run again, a runner whose build file the developer removed", () => {
    vitestProject(project);
    expect(init(project, "--mode", "remix").code).toBe(0);
    const stateFile = file(project, ".verid/.state/state.json");
    writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, runners: ["vitest@.", "go@."] }));
    const again = init(project);
    expect(again.stdout).toContain("~ state.json");
    expect(again.stdout).toMatch(/^! en: verid forgets the runners it no longer finds: go\./m);
    expect(json(project, ".verid/.state/state.json").runners).toEqual(["vitest@."]);
    expect(init(project).stdout).toContain("= state.json");
  });

  it("sets up an empty folder for prep, with the gate on from the start", () => {
    const r = init(project, "--mode", "prep", ...NO_RUNNER);
    expect(r.code).toBe(0);
    const written = read(project, ".verid/manifest.yaml");
    expect({
      mode: written.includes('mode: "prep"'),
      roles: written.includes('  reviewer: ["verid:reviewer"]'),
      e2e: written.includes('    e2e_globs: ["**/e2e/**","**/*.e2e.*"]'),
      plugin: [
        "claude plugin marketplace add anhtranhai835/verid",
        "claude plugin install verid@verid",
      ].filter((c) => !r.stdout.includes(c)),
    }).toEqual({ mode: true, roles: true, e2e: true, plugin: [] });

    // Production code waits for the developer to approve the plan, before the cycle even counts:
    // code in any language and folder, while tests and documents stay writable. cook maps verid's
    // tester and coder, so the main conversation writes neither: it dispatches them.
    const verdict = (rel: string) => {
      const r = hook(project, "PreToolUse", writeTo(project, rel));
      return r.code === 0 ? "allowed" : /verid \[(\w+)\]/.exec(r.stderr)?.[1];
    };
    expect({
      "src/a.ts": verdict("src/a.ts"),
      "src/main/java/App.java": verdict("src/main/java/App.java"),
      "src/test/java/AppTest.java": verdict("src/test/java/AppTest.java"),
      "README.md": verdict("README.md"),
    }).toEqual({
      "src/a.ts": "VERID_BURNT_TASK_SESSION",
      "src/main/java/App.java": "VERID_BURNT_TASK_SESSION",
      "src/test/java/AppTest.java": "VERID_BURNT_TASK_SESSION",
      "README.md": "allowed",
    });

    const run = cli(project, "taste");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("verid [VERID_BURNT_RUN_NO_JUNIT]");
    expect(json(project, ".verid/.state/state.json").tdd.state).toBe("RAW");
  });

  it("verid peek warns while this machine's hooks are not registered", () => {
    put(project, ".verid/.state/state.json", '{"schemaVersion":1}');
    const status = () =>
      spawnSync(process.execPath, [CLI, "peek"], {
        cwd: project,
        env: cleanEnv(),
        encoding: "utf8",
      });
    const before = status();
    expect(before.status).toBe(0);
    expect(before.stderr).toContain("not registered on this machine");

    expect(init(project, "--mode", "prep", ...NO_RUNNER).code).toBe(0);
    expect(status().stderr).toBe("");
  });

  it("refuses to run inside Claude Code: only the developer sets verid up", () => {
    vitestProject(project);
    const r = initWith({ ...cleanEnv(), CLAUDECODE: "1" }, project);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("verid [VERID_BURNT_INIT_IN_AGENT]");
    expect(existsSync(file(project, ".verid"))).toBe(false);
    expect(existsSync(file(project, ".claude"))).toBe(false);
  });

  it("needs --mode for a new manifest, suggests one, and writes nothing", () => {
    vitestProject(project);
    const withSource = init(project);
    expect(withSource.code).toBe(2);
    expect(withSource.stderr).toContain("verid [VERID_BURNT_INIT_NO_MODE]");
    expect(withSource.stderr).toContain("--mode remix");
    expect(readdirSync(project).sort()).toEqual(["package.json", "src", "test"]);

    const empty = newProject();
    const noSource = init(empty);
    expect(noSource.code).toBe(2);
    expect(noSource.stderr).toContain("verid [VERID_BURNT_INIT_NO_MODE]");
    expect(noSource.stderr).toContain("--mode prep");
    expect(readdirSync(empty)).toEqual([]);
  });

  it("writes the drive the developer picks, and refuses one the mode cannot take", () => {
    const run = (...flags: string[]) => {
      rmSync(file(project, ".verid"), { recursive: true, force: true });
      const r = init(project, "--lang", "en", ...flags);
      if (r.code === 0)
        return read(project, ".verid/manifest.yaml").includes('drive: "ai"') ? "auto" : "human";
      // The refusal names the code, the flag it cannot use and why: `use <flag> (<why>) and`.
      return /verid \[(\w+)\][\s\S]*?use (\S+) \((.*?)\) and/.exec(r.stderr)?.slice(1).join(" ");
    };
    expect({
      default: run("--mode", "prep"),
      auto: run("--mode", "prep", "--drive", "auto"),
      recipe: run("--mode", "recipe", "--drive", "auto"),
      remix: run("--mode", "remix", "--drive", "auto"),
      other: run("--mode", "prep", "--drive", "fast"),
    }).toEqual({
      default: "human",
      auto: "auto",
      recipe: "auto",
      remix: "VERID_BURNT_INIT_INVALID --drive drive: auto needs mode prep or recipe",
      other: "VERID_BURNT_INIT_INVALID --drive must be human or ai",
    });
  });

  it("leaves an existing manifest alone and says the flags were ignored", () => {
    vitestProject(project);
    expect(init(project, "--mode", "remix", "--lang", "en").code).toBe(0);
    const before = read(project, ".verid/manifest.yaml");
    const r = init(project, "--src", "app/**", "--mode", "prep");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^! The manifest already exists/m);
    expect(read(project, ".verid/manifest.yaml")).toBe(before);
    expect(init(project, "--drive", "auto").stdout).toMatch(
      /^! The manifest already exists.*--drive/m,
    );
    expect(read(project, ".verid/manifest.yaml")).toBe(before);
  });

  it("changes nothing when given broken settings, an invalid manifest or a glob it cannot match", () => {
    const rows: [string, () => void, string, string[]][] = [
      [
        "settings that are not JSON",
        () => put(project, LOCAL, "{ nope"),
        "VERID_BURNT_INIT_INVALID",
        [],
      ],
      [
        "an invalid manifest",
        () => put(project, ".verid/manifest.yaml", "schemaVersion: 1\nrepos: ["),
        "VERID_BURNT_MANIFEST_INVALID",
        [],
      ],
      [
        "a glob it cannot match",
        () => vitestProject(project),
        "VERID_BURNT_INIT_INVALID",
        ["--mode", "remix", "--src", "src/**/*.{ts,tsx}"],
      ],
      [
        "a folder given as the glob",
        () => vitestProject(project),
        "VERID_BURNT_INIT_INVALID",
        ["--mode", "remix", "--src", "src"],
      ],
    ];
    for (const [name, setup, code, args] of rows) {
      // An empty folder for each case.
      rmSync(project, { recursive: true, force: true });
      mkdirSync(project);
      setup();
      const r = init(project, ...args);
      expect(r.code, name).toBe(2);
      expect(r.stderr, name).toContain(`verid [${code}]`);
      expect(existsSync(file(project, ".verid/.state")), name).toBe(false);
    }
  });
});
