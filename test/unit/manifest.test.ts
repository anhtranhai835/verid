import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  DEFAULT_ROLES,
  E2E_GLOBS,
  IGNORE_GLOBS,
  manifestUpgrade,
  MODES,
  TEST_GLOBS,
  parseManifest,
  renderManifest,
  suggestManifest,
  suggestMode,
} from "../../src/core/manifest.js";
import { fileRole } from "../../src/core/tdd.js";
import { upgradeManifestText } from "../../src/adapters/manifest.js";

const repo = {
  test_cmd: "npx vitest run --reporter=junit --outputFile={junit}",
  source_globs: ["src/**"],
  test_globs: ["test/**"],
};

describe("parseManifest", () => {
  it("accepts and renders a default branch and refuses an empty one", () => {
    const rows = [
      { branch: "main", ok: true },
      { branch: "", ok: false },
    ];
    for (const { branch, ok } of rows) {
      const r = parseManifest({
        schemaVersion: 1,
        mode: "remix",
        repos: [
          {
            path: ".",
            default_branch: branch,
            source_globs: ["src/**"],
            test_globs: ["test/**"],
          },
        ],
      });
      expect(r.ok).toBe(ok);
      if (r.ok) {
        expect(r.manifest.repos[0]?.default_branch).toBe("main");
        expect(renderManifest("remix", r.manifest.repos[0]!)).toContain('default_branch: "main"');
      }
    }
  });

  it("accepts one repo, defaults its path to the project dir, and keeps a timeout", () => {
    const doc = { schemaVersion: 1, mode: "remix", repos: [{ ...repo, timeout_sec: 300 }] };
    expect(parseManifest(doc)).toEqual({
      ok: true,
      manifest: {
        schemaVersion: 1,
        mode: "remix",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: [],
        repos: [{ path: ".", ...repo, timeout_sec: 300 }],
      },
    });
  });

  it("accepts a repo without test_cmd: verid finds the test runner itself", () => {
    const { test_cmd: _, ...auto } = repo;
    expect(parseManifest({ schemaVersion: 1, mode: "prep", repos: [auto] })).toEqual({
      ok: true,
      manifest: {
        schemaVersion: 1,
        mode: "prep",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: [],
        repos: [{ path: ".", ...auto }],
      },
    });
  });

  it("accepts every mode, and a test_cmd that reads the report path from VERID_JUNIT", () => {
    const test_cmd = 'JUNIT="$VERID_JUNIT" pytest';
    const ok = MODES.map(
      (mode) => parseManifest({ schemaVersion: 1, mode, repos: [{ ...repo, test_cmd }] }).ok,
    );
    expect(ok).toEqual([true, true, true]);
  });

  it("rejects a manifest it cannot trust, naming the field", () => {
    const rows: [string, unknown, RegExp][] = [
      ["null (empty file)", null, /mapping/],
      [
        "a future schemaVersion",
        { schemaVersion: 2, mode: "remix", repos: [repo] },
        /schemaVersion/,
      ],
      ["no mode", { schemaVersion: 1, repos: [repo] }, /^mode: .*prep, recipe or remix/],
      ["two repos", { schemaVersion: 1, mode: "remix", repos: [repo, repo] }, /^repos/],
      [
        "a test_cmd without {junit}",
        { schemaVersion: 1, mode: "remix", repos: [{ ...repo, test_cmd: "npm test" }] },
        /^repos\.0\.test_cmd/,
      ],
      [
        "no source globs",
        { schemaVersion: 1, mode: "remix", repos: [{ ...repo, source_globs: [] }] },
        /^repos\.0\.source_globs/,
      ],
      [
        "a zero timeout",
        { schemaVersion: 1, mode: "remix", repos: [{ ...repo, timeout_sec: 0 }] },
        /^repos\.0\.timeout_sec/,
      ],
    ];
    for (const [name, doc, detail] of rows) {
      const r = parseManifest(doc);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.detail, name).toMatch(detail);
    }
  });

  it("reads roles, and refuses an agent in two roles, an empty list or an unknown role", () => {
    const rows: [string, unknown, string][] = [
      ["a reviewer only", { reviewer: ["feature-dev:code-reviewer"] }, "ok"],
      ["all three roles", { reviewer: ["a"], tester: ["b"], coder: ["general-purpose"] }, "ok"],
      ["a researcher", { researcher: ["verid:researcher"] }, "ok"],
      ["an architect", { architect: ["verid:architect"] }, "ok"],
      ["a planner", { planner: ["verid:planner"] }, "ok"],
      ["qa without a split", { qa: ["verid:qa"] }, "ok"],
      [
        "one drafter in two roles",
        { researcher: ["draft"], architect: ["draft"] },
        "roles: draft is both researcher and architect",
      ],
      ["an empty qa list", { qa: [] }, "roles.qa: must not be empty"],
      [
        "one agent in two roles",
        { reviewer: ["a"], coder: ["a"] },
        "roles: a is both reviewer and coder",
      ],
      ["an empty list", { reviewer: [] }, "roles.reviewer: must not be empty"],
      ["an unknown role", { judge: ["a"] }, "roles: unknown key judge"],
      [
        "a tester without a coder",
        { reviewer: ["a"], tester: ["b"] },
        "roles: tester and coder go together",
      ],
      [
        "a coder without a tester",
        { coder: ["general-purpose"] },
        "roles: tester and coder go together",
      ],
      ["no roles", undefined, "ok"],
    ];
    for (const [name, roles, want] of rows) {
      const doc = {
        schemaVersion: 1,
        mode: "prep",
        repos: [repo],
        ...(roles !== undefined && { roles }),
      };
      const r = parseManifest(doc);
      expect(r.ok ? "ok" : r.detail, name).toBe(want);
      if (r.ok && roles !== undefined) expect(r.manifest.roles, name).toEqual(roles);
    }
  });

  it("reads drive, human by default, auto only for prep or recipe with every role mapped", () => {
    const roles = { reviewer: ["r"], tester: ["t"], coder: ["c"] };
    const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };
    const read = (doc: object) => {
      const r = parseManifest({ schemaVersion: 1, repos: [repo], ...doc });
      return r.ok ? r.manifest.drive : r.detail;
    };
    expect({
      none: read({ mode: "prep", roles }),
      human: read({ mode: "remix", drive: "human" }),
      auto: read({ mode: "recipe", drive: "auto", roles }),
      remix: read({ mode: "remix", drive: "auto", roles }),
      "no reviewer": read({ mode: "prep", drive: "auto", roles: { tester: ["t"], coder: ["c"] } }),
      "no split": read({ mode: "prep", drive: "auto", roles: { reviewer: ["r"] } }),
      "no roles": read({ mode: "prep", drive: "auto" }),
      other: read({ mode: "prep", drive: "fast", roles }),
    }).toEqual({
      none: "human",
      human: "human",
      auto: "auto",
      remix: "drive: auto needs mode prep or recipe",
      "no reviewer": "drive: auto needs roles reviewer, tester and coder",
      "no split": "drive: auto needs roles reviewer, tester and coder",
      "no roles": "drive: auto needs roles reviewer, tester and coder",
      other: "drive: must be human or auto",
    });
  });

  // Syntax the matcher does not support would never match and silently switch the gate off.
  it("rejects globs the matcher does not support", () => {
    for (const g of [
      "src/**/*.{ts,tsx}",
      "src/[ab].ts",
      "!src/**",
      "/src/**",
      "C:/proj/src/**",
      "../src/**",
    ])
      expect(
        parseManifest({ schemaVersion: 1, mode: "remix", repos: [{ ...repo, source_globs: [g] }] }),
        g,
      ).toEqual({
        ok: false,
        detail: "repos.0.source_globs.0: only **, * and ? are supported, relative to the repo path",
      });
  });

  // A folder or a comma list matches no file path either: the gate would be off just the same.
  it("rejects a folder named as a glob and several globs in one, in source and test globs", () => {
    const folder = "names a folder, which matches no file: add /** for everything in it";
    const comma = "holds a comma: give each glob as its own list item";
    const check = (field: "source_globs" | "test_globs" | "ignore_globs", g: string) =>
      parseManifest({ schemaVersion: 1, mode: "remix", repos: [{ ...repo, [field]: [g] }] });
    expect({
      src: check("source_globs", "src"),
      "src/": check("source_globs", "src/"),
      "src\\core\\": check("source_globs", "src\\core\\"),
      "src/**, lib/**": check("source_globs", "src/**, lib/**"),
      "tests/": check("test_globs", "tests/"),
      "docs/, ignored": check("ignore_globs", "docs/"),
      "main.py, a file": check("source_globs", "main.py").ok,
      "src/**, a folder's content": check("source_globs", "src/**").ok,
    }).toEqual({
      src: { ok: false, detail: `repos.0.source_globs.0: ${folder}` },
      "src/": { ok: false, detail: `repos.0.source_globs.0: ${folder}` },
      "src\\core\\": { ok: false, detail: `repos.0.source_globs.0: ${folder}` },
      "src/**, lib/**": { ok: false, detail: `repos.0.source_globs.0: ${comma}` },
      "tests/": { ok: false, detail: `repos.0.test_globs.0: ${folder}` },
      "docs/, ignored": { ok: false, detail: `repos.0.ignore_globs.0: ${folder}` },
      "main.py, a file": true,
      "src/**, a folder's content": true,
    });
  });
});

describe("suggestMode", () => {
  it("suggests remix for a folder with source code and prep otherwise, never recipe", () => {
    expect(suggestMode({ sourceDir: "src" })).toBe("remix");
    expect(suggestMode({})).toBe("prep");
  });
});

describe("suggestManifest", () => {
  const noFlags = { src: [], tests: [] };
  // Tests by the conventions of the common languages, and runner config that can deselect them.
  const TESTS = [
    "**/test/**",
    "**/tests/**",
    "**/spec/**",
    "**/__tests__/**",
    "**/*.Tests/**",
    "**/androidTest/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.*",
    "**/*_spec.*",
    "**/test_*.*",
    "**/vitest.config.*",
    "**/vite.config.*",
    "**/jest.config.*",
    "**/conftest.py",
    "**/pytest.ini",
  ];
  // Documents, data and config, web assets, and folders that tools write or own.
  const IGNORED = [
    "**/*.md",
    "**/*.txt",
    "**/*.rst",
    "**/*.json",
    "**/*.yaml",
    "**/*.yml",
    "**/*.toml",
    "**/*.xml",
    "**/*.lock",
    "**/*.csv",
    "**/*.config",
    "**/*.config.*",
    "**/*.csproj",
    "**/*.fsproj",
    "**/*.vbproj",
    "**/*.sln",
    "**/*.slnx",
    "**/*.props",
    "**/*.targets",
    "**/go.mod",
    "**/go.sum",
    "**/Gemfile",
    "**/*.gemspec",
    "**/Pipfile",
    "**/setup.py",
    "**/*.gradle",
    "**/*.gradle.kts",
    "**/gradle.properties",
    "**/gradlew*",
    "**/mvnw*",
    "**/Dockerfile*",
    "**/Makefile",
    "**/LICENSE*",
    "**/.*",
    "**/*.html",
    "**/*.css",
    "**/*.scss",
    "**/*.svg",
    "**/*.png",
    "**/*.jpg",
    "**/*.gif",
    "**/*.ico",
    ".verid/**",
    ".claude/**",
    ".git/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/target/**",
    "**/coverage/**",
    "**/.venv/**",
    "**/venv/**",
    "**/__pycache__/**",
  ];

  it("locks every file but tests and the ignored ones, and leaves the test runner to verid", () => {
    expect(suggestManifest(noFlags)).toEqual({
      path: ".",
      source_globs: ["**"],
      test_globs: TESTS,
      ignore_globs: IGNORED,
      e2e_globs: ["**/e2e/**", "**/*.e2e.*"],
    });
  });

  // Adding a library edits one of these: it must work in RAW and before a module is approved.
  it("leaves build and dependency files free in every language, and locks the code", () => {
    const made = suggestManifest(noFlags);
    const layout = {
      sourceGlobs: made.source_globs,
      testGlobs: made.test_globs,
      ignoreGlobs: made.ignore_globs ?? [],
      e2eGlobs: made.e2e_globs ?? [],
    };
    const files = [
      "package.json",
      "pom.xml",
      "Cargo.toml",
      "pyproject.toml",
      "src/App/App.csproj",
      "App.sln",
      "Directory.Build.props",
      "nuget.config",
      "go.mod",
      "go.sum",
      "Gemfile",
      "app.gemspec",
      "Pipfile",
      "setup.py",
      "build.gradle",
      "app/build.gradle.kts",
      "settings.gradle",
      "gradle.properties",
      "gradlew",
      "mvnw.cmd",
      "Dockerfile",
      "Makefile",
      "LICENSE",
      ".gitignore",
      "web/.prettierrc",
      ".env.example",
      "eslint.config.js",
      "tailwind.config.ts",
      "next.config.mjs",
      "vite.config.ts",
      "src/App/Program.cs",
      "main.go",
      "src/main/kotlin/App.kt",
      "lib/app.rb",
      "scripts/setup.sh",
      "db/migrations/001_init.sql",
    ];
    expect(Object.fromEntries(files.map((f) => [f, fileRole(f, layout)]))).toEqual({
      "package.json": "free",
      "pom.xml": "free",
      "Cargo.toml": "free",
      "pyproject.toml": "free",
      "src/App/App.csproj": "free",
      "App.sln": "free",
      "Directory.Build.props": "free",
      "nuget.config": "free",
      "go.mod": "free",
      "go.sum": "free",
      Gemfile: "free",
      "app.gemspec": "free",
      Pipfile: "free",
      "setup.py": "free",
      "build.gradle": "free",
      "app/build.gradle.kts": "free",
      "settings.gradle": "free",
      "gradle.properties": "free",
      gradlew: "free",
      "mvnw.cmd": "free",
      Dockerfile: "free",
      Makefile: "free",
      LICENSE: "free",
      ".gitignore": "free",
      "web/.prettierrc": "free",
      ".env.example": "free",
      "eslint.config.js": "free",
      "tailwind.config.ts": "free",
      "next.config.mjs": "free",
      // vitest reads it too, so it can deselect tests: frozen in COOKING like the others.
      "vite.config.ts": "test",
      "src/App/Program.cs": "code",
      "main.go": "code",
      "src/main/kotlin/App.kt": "code",
      "lib/app.rb": "code",
      "scripts/setup.sh": "code",
      "db/migrations/001_init.sql": "code",
    });
  });

  it("takes the test command and the globs from the flags", () => {
    const flags = {
      testCmd: "make test JUNIT={junit}",
      src: ["lib/**"],
      tests: ["spec/**"],
      ignore: ["examples/**"],
    };
    expect(suggestManifest(flags)).toEqual({
      path: ".",
      test_cmd: "make test JUNIT={junit}",
      source_globs: ["lib/**"],
      test_globs: ["spec/**"],
      ignore_globs: [...IGNORED, "examples/**"],
      e2e_globs: E2E_GLOBS,
    });
  });
});

describe("renderManifest", () => {
  it("says in a comment that verid finds the runner when there is no test_cmd", () => {
    const repo = { path: ".", source_globs: ["**"], test_globs: ["test/**"] };
    const text = renderManifest("prep", repo);
    expect(text.split("\n").slice(7, 10)).toEqual([
      '  - path: "."',
      "    # test_cmd: verid finds the test runner from the build files; set one to choose it",
      '    source_globs: ["**"]',
    ]);
    expect(parseManifest(parse(text))).toEqual({
      ok: true,
      manifest: {
        schemaVersion: 1,
        mode: "prep",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: ["general-purpose"],
        repos: [repo],
      },
    });
  });

  it("writes YAML that reads back as the same manifest", () => {
    const repo = {
      path: ".",
      test_cmd: 'npx vitest run --reporter=junit --outputFile={junit} # "quoted"',
      source_globs: ["src/**"],
      test_globs: ["test/**", "**/*.test.*"],
      ignore_globs: ["**/*.md"],
      e2e_globs: ["**/e2e/**"],
    };
    const text = renderManifest("prep", repo);
    expect(text).toBe(
      [
        "# verid manifest: only the developer edits this file. Commit it with the project.",
        "schemaVersion: 1",
        'mode: "prep" # prep | recipe | remix',
        'providers: ["claude-code"] # claude-code | codex',
        "allowed_skills: [] # additional exact names or prefix:*; verid:*, superpowers:*, andrej-karpathy-skills:* are always allowed",
        'allowed_agents: ["general-purpose"] # superpowers dispatches; roles are always allowed',
        "repos:",
        '  - path: "."',
        '    test_cmd: "npx vitest run --reporter=junit --outputFile={junit} # \\"quoted\\""',
        '    source_globs: ["src/**"]',
        '    test_globs: ["test/**","**/*.test.*"]',
        '    ignore_globs: ["**/*.md"]',
        '    e2e_globs: ["**/e2e/**"]',
        "",
      ].join("\n"),
    );
    expect(parseManifest(parse(text))).toEqual({
      ok: true,
      manifest: {
        schemaVersion: 1,
        mode: "prep",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: ["general-purpose"],
        repos: [repo],
      },
    });
  });

  it("maps verid's own agents to the roles, which read back", () => {
    const repo = { path: ".", source_globs: ["**"], test_globs: ["test/**"] };
    const text = renderManifest("prep", repo, DEFAULT_ROLES);
    expect(text.split("\n").filter((l) => /^(roles:|  [a-z]+: \[)/.test(l))).toEqual([
      "roles: # agent types Claude Code reports, from the verid plugin; any agent can fill a role",
      '  reviewer: ["verid:reviewer"]',
      '  tester: ["verid:tester"]',
      '  coder: ["verid:coder"]',
      '  researcher: ["verid:researcher"]',
      '  architect: ["verid:architect"]',
      '  planner: ["verid:planner"]',
      '  qa: ["verid:qa"]',
    ]);
    expect(parseManifest(parse(text))).toEqual({
      ok: true,
      manifest: {
        schemaVersion: 1,
        mode: "prep",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: ["general-purpose"],
        roles: {
          reviewer: ["verid:reviewer"],
          tester: ["verid:tester"],
          coder: ["verid:coder"],
          researcher: ["verid:researcher"],
          architect: ["verid:architect"],
          planner: ["verid:planner"],
          qa: ["verid:qa"],
        },
        repos: [repo],
      },
    });
  });

  it("writes drive only when it is auto", () => {
    const repo = suggestManifest({ src: [], tests: [] });
    expect({
      auto: renderManifest("prep", repo, DEFAULT_ROLES, "auto").includes(
        'drive: "auto" # human | auto',
      ),
      human: renderManifest("prep", repo, DEFAULT_ROLES, "human").includes("drive:"),
      unset: renderManifest("prep", repo, DEFAULT_ROLES).includes("drive:"),
    }).toEqual({ auto: true, human: false, unset: false });
  });
});

describe("manifestUpgrade", () => {
  const old = {
    path: ".",
    test_cmd: "npx vitest run --reporter=junit --outputFile={junit}",
    source_globs: ["**"],
    test_globs: TEST_GLOBS.filter((g) => g !== "**/vite.config.*"),
    ignore_globs: [
      ...IGNORE_GLOBS.filter((g) => g !== "**/.*" && g !== "**/go.mod"),
      "examples/**",
    ],
  };
  it("names the defaults a manifest from an older verid lacks, and its old runner preset", () => {
    expect({
      old: manifestUpgrade(old),
      "own test_cmd": manifestUpgrade({ ...old, test_cmd: "make test JUNIT={junit}" }).dropTestCmd,
      "old pytest preset": manifestUpgrade({
        ...old,
        test_cmd: "python -m pytest --junitxml={junit}",
      }).dropTestCmd,
      "up to date": manifestUpgrade(suggestManifest({ src: [], tests: [] }), DEFAULT_ROLES),
      "own test globs": manifestUpgrade({ ...old, test_globs: ["spec/**"] }).tests,
      "own e2e globs": manifestUpgrade({ ...old, e2e_globs: ["web/**"] }).e2e,
      "own roles": manifestUpgrade(old, { reviewer: ["feature-dev:code-reviewer"] }).roles,
    }).toEqual({
      old: {
        tests: ["**/vite.config.*"],
        ignore: ["**/go.mod", "**/.*"],
        e2e: ["**/e2e/**", "**/*.e2e.*"],
        roles: {
          reviewer: ["verid:reviewer"],
          tester: ["verid:tester"],
          coder: ["verid:coder"],
          researcher: ["verid:researcher"],
          architect: ["verid:architect"],
          planner: ["verid:planner"],
          qa: ["verid:qa"],
        },
        dropTestCmd: true,
      },
      "own test_cmd": false,
      "old pytest preset": true,
      "up to date": { tests: [], ignore: [], e2e: [], roles: null, dropTestCmd: false },
      "own test globs": [],
      "own e2e globs": [],
      "own roles": {
        researcher: ["verid:researcher"],
        architect: ["verid:architect"],
        planner: ["verid:planner"],
        qa: ["verid:qa"],
      },
    });
  });

  it("offers missing optional roles without replacing mappings or assigning one name twice", () => {
    const rows = [
      {
        roles: { reviewer: ["custom:r"], researcher: ["custom:research"] },
        want: { architect: ["verid:architect"], planner: ["verid:planner"], qa: ["verid:qa"] },
      },
      {
        roles: { reviewer: ["verid:qa"] },
        want: {
          researcher: ["verid:researcher"],
          architect: ["verid:architect"],
          planner: ["verid:planner"],
        },
      },
    ];
    for (const { roles, want } of rows) expect(manifestUpgrade(old, roles).roles).toEqual(want);
  });
});

describe("upgradeManifestText", () => {
  it("adds new role defaults while keeping existing role entries and their comments", async () => {
    const raw = [
      "schemaVersion: 1",
      "mode: prep",
      "roles:",
      '  reviewer: ["custom:reviewer"] # keep this reviewer',
      '  researcher: ["custom:researcher"] # keep this researcher',
      "repos:",
      '  - path: "."',
      '    source_globs: ["**"]',
      '    test_globs: ["test/**"]',
      "",
    ].join("\n");
    const text = await upgradeManifestText(raw, {
      tests: [],
      ignore: [],
      e2e: [],
      dropTestCmd: false,
      roles: { architect: ["verid:architect"], planner: ["verid:planner"], qa: ["verid:qa"] },
    });
    expect(parse(text).roles).toEqual({
      reviewer: ["custom:reviewer"],
      researcher: ["custom:researcher"],
      architect: ["verid:architect"],
      planner: ["verid:planner"],
      qa: ["verid:qa"],
    });
    expect(text).toContain("# keep this reviewer");
    expect(text).toContain("# keep this researcher");
  });

  it("adds the missing defaults and drops an old preset, keeping comments and the developer's entries", async () => {
    const raw = [
      "# verid manifest: only the developer edits this file. Commit it with the project.",
      "schemaVersion: 1",
      'mode: "remix" # prep | recipe | remix',
      "repos:",
      '  - path: "."',
      '    test_cmd: "npx vitest run --reporter=junit --outputFile={junit}"',
      '    source_globs: ["**"]',
      '    test_globs: ["**/test/**"] # mine',
      '    ignore_globs: ["examples/**"]',
      "",
    ].join("\n");
    const text = await upgradeManifestText(raw, {
      tests: ["**/vite.config.*"],
      ignore: ["**/.*", ".verid/**"],
      e2e: ["**/e2e/**"],
      roles: { reviewer: ["verid:reviewer"], tester: ["verid:tester"], coder: ["verid:coder"] },
      dropTestCmd: true,
    });
    expect(text.startsWith("# verid manifest: only the developer edits this file.")).toBe(true);
    expect(text).toContain("# mine");
    // Quoted like the globs verid cook writes.
    expect(
      ["**/vite.config.*", "**/.*", ".verid/**"].filter((g) => !text.includes(`"${g}"`)),
    ).toEqual([]);
    expect(parseManifest(parse(text))).toEqual({
      ok: true,
      manifest: {
        schemaVersion: 1,
        mode: "remix",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: ["general-purpose"],
        roles: { reviewer: ["verid:reviewer"], tester: ["verid:tester"], coder: ["verid:coder"] },
        repos: [
          {
            path: ".",
            source_globs: ["**"],
            test_globs: ["**/test/**", "**/vite.config.*"],
            ignore_globs: ["examples/**", "**/.*", ".verid/**"],
            e2e_globs: ["**/e2e/**"],
          },
        ],
      },
    });
  });
});
