import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  DEFAULT_ROLES,
  defaultRoles,
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
  it("accepts mockup modes, defaults an empty UI setting to ask and rejects unknown modes", () => {
    const doc = { schemaVersion: 1, mode: "prep", repos: [repo] };
    expect(parseManifest(doc).ok).toBe(true);
    for (const mockups of ["ask", "ascii", "browser", undefined]) {
      const parsed = parseManifest({ ...doc, ui: mockups ? { mockups } : {} });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.manifest.ui?.mockups).toBe(mockups ?? "ask");
    }
    expect(parseManifest({ ...doc, ui: { mockups: "always" } }).ok).toBe(false);
    expect(parseManifest({ ...doc, ui: { extra: true } }).ok).toBe(false);
  });

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
        architecture: "ddd",
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
        architecture: "ddd",
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
      ["a planner", { planner: ["verid:planner"] }, "ok"],
      ["an architect", { architect: ["verid:architect"] }, "ok"],
      ["a planner", { planner: ["verid:planner"] }, "ok"],
      ["qa without a split", { qa: ["verid:qa"] }, "ok"],
      [
        "one drafter in two roles",
        { architect: ["draft"], planner: ["draft"] },
        "roles: draft is both architect and planner",
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
      remix: "drive: no-brain needs mode prep or recipe",
      "no reviewer": "drive: no-brain needs roles reviewer, tester and coder",
      "no split": "drive: no-brain needs roles reviewer, tester and coder",
      "no roles": "drive: no-brain needs roles reviewer, tester and coder",
      other: "drive: must be no-brain or big-brain",
    });
  });

  it("reads the drive names no-brain and big-brain, and still the older human, ai and auto", () => {
    const roles = { reviewer: ["r"], tester: ["t"], coder: ["c"] };
    const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };
    const read = (drive: string) => {
      const r = parseManifest({ schemaVersion: 1, mode: "prep", repos: [repo], roles, drive });
      return r.ok ? r.manifest.drive : r.detail;
    };
    expect(
      Object.fromEntries(
        ["no-brain", "big-brain", "human", "ai", "auto", "robot"].map((d) => [d, read(d)]),
      ),
    ).toEqual({
      "no-brain": "auto",
      "big-brain": "human",
      human: "human",
      ai: "auto",
      auto: "auto",
      robot: "drive: must be no-brain or big-brain",
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
    expect(text.split("\n").slice(9, 12)).toEqual([
      '  - path: "."',
      "    # test_cmd: verid finds the test runner from the build files; set one to choose it",
      '    source_globs: ["**"]',
    ]);
    expect(parseManifest(parse(text))).toEqual({
      ok: true,
      manifest: {
        architecture: "ddd",
        schemaVersion: 1,
        mode: "prep",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: [],
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
        'providers: ["claude-code"] # claude-code | codex | antigravity',
        "architecture: ddd # ddd | clean | layered | none",
        "allowed_skills: [] # additional exact names or prefix:*; verid:* is known by default",
        "allowed_agents: [] # roles are known by default",
        'layout: "monorepo" # monorepo | workspace',
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
        architecture: "ddd",
        schemaVersion: 1,
        mode: "prep",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: [],
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
      '  architect: ["verid:architect"]',
      '  planner: ["verid:planner"]',
      '  qa: ["verid:qa"]',
      '  security: ["verid:security"]',
    ]);
    expect(parseManifest(parse(text))).toEqual({
      ok: true,
      manifest: {
        architecture: "ddd",
        schemaVersion: 1,
        mode: "prep",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: [],
        roles: {
          reviewer: ["verid:reviewer"],
          tester: ["verid:tester"],
          coder: ["verid:coder"],
          architect: ["verid:architect"],
          planner: ["verid:planner"],
          qa: ["verid:qa"],
          security: ["verid:security"],
        },
        repos: [repo],
      },
    });
  });

  it("writes drive only when it is auto, by its name no-brain", () => {
    const repo = suggestManifest({ src: [], tests: [] });
    expect({
      auto: renderManifest("prep", repo, DEFAULT_ROLES, "auto").includes(
        'drive: "no-brain" # big-brain | no-brain',
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
  it("names the defaults a manifest from an older verid lacks", () => {
    expect({
      old: manifestUpgrade(old),
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
          architect: ["verid:architect"],
          planner: ["verid:planner"],
          qa: ["verid:qa"],
          security: ["verid:security"],
        },
      },
      "up to date": { tests: [], ignore: [], e2e: [], roles: null },
      "own test globs": [],
      "own e2e globs": [],
      "own roles": {
        architect: ["verid:architect"],
        planner: ["verid:planner"],
        qa: ["verid:qa"],
        security: ["verid:security"],
      },
    });
  });

  it("offers missing optional roles without replacing mappings or assigning one name twice", () => {
    const rows = [
      {
        roles: { reviewer: ["custom:r"], architect: ["custom:architecture"] },
        want: {
          planner: ["verid:planner"],
          qa: ["verid:qa"],
          security: ["verid:security"],
        },
      },
      {
        roles: { reviewer: ["verid:qa"] },
        want: {
          architect: ["verid:architect"],
          planner: ["verid:planner"],
          security: ["verid:security"],
        },
      },
    ];
    for (const { roles, want } of rows) expect(manifestUpgrade(old, roles).roles).toEqual(want);
  });

  it("maps the security reviewer only where Claude Code runs; Codex's reviewer covers security there", () => {
    const optional = {
      architect: ["verid:architect"],
      planner: ["verid:planner"],
      qa: ["verid:qa"],
    };
    const own = { reviewer: ["custom:r"] };
    const kept = { reviewer: ["custom:r"], security: ["custom:security"] };
    const rows = [
      ["upgrade, Codex only", manifestUpgrade(old, own, ["codex"]).roles, optional],
      [
        "upgrade, both providers",
        manifestUpgrade(old, own, ["claude-code", "codex"]).roles,
        { ...optional, security: ["verid:security"] },
      ],
      [
        "upgrade keeps a mapped security reviewer",
        manifestUpgrade(old, kept, ["codex"]).roles,
        optional,
      ],
      ["cook, Codex only", defaultRoles(["codex"]).security, undefined],
      ["cook, Claude Code", defaultRoles(["claude-code"]).security, ["verid:security"]],
      [
        "cook, Codex reviewer",
        defaultRoles(["codex"]).reviewer,
        ["verid:reviewer", "verid_reviewer"],
      ],
    ] as const;
    for (const [name, got, want] of rows) expect(got, name).toEqual(want);
  });
});

describe("upgradeManifestText", () => {
  it("adds new role defaults while keeping existing role entries and their comments", async () => {
    const raw = [
      "schemaVersion: 1",
      "mode: prep",
      "roles:",
      '  reviewer: ["custom:reviewer"] # keep this reviewer',
      '  security: ["custom:security"] # keep this security',
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
      roles: { architect: ["verid:architect"], planner: ["verid:planner"], qa: ["verid:qa"] },
    });
    expect(parse(text).roles).toEqual({
      reviewer: ["custom:reviewer"],
      security: ["custom:security"],
      architect: ["verid:architect"],
      planner: ["verid:planner"],
      qa: ["verid:qa"],
    });
    expect(text).toContain("# keep this reviewer");
    expect(text).toContain("# keep this security");
  });

  it("reads an opt-in architecture_check per repo, and keeps it through render and upgrade", async () => {
    const check = {
      command: "npm run architecture",
      inputs: [".dependency-cruiser.cjs", "tsconfig.json"],
      timeout_sec: 100,
    };
    const manifestWith = (architecture_check: unknown) => ({
      schemaVersion: 1,
      mode: "prep",
      repos: [{ ...repo, ...(architecture_check !== undefined && { architecture_check }) }],
    });
    const status = (doc: unknown) => {
      const r = parseManifest(doc);
      return !r.ok ? "invalid" : r.manifest.repos[0]?.architecture_check ? "enabled" : "disabled";
    };
    const preserved = async (via: "render" | "upgrade") => {
      const r = parseManifest(manifestWith(check));
      if (!r.ok) return "invalid";
      const text =
        via === "render"
          ? renderManifest("prep", r.manifest.repos)
          : await upgradeManifestText(renderManifest("prep", r.manifest.repos), {
              tests: ["**/vite.config.*"],
              ignore: [],
              e2e: [],
              roles: null,
            });
      const back = parseManifest(parse(text));
      return back.ok &&
        JSON.stringify(back.manifest.repos[0]?.architecture_check) === JSON.stringify(check)
        ? "preserved"
        : "lost";
    };
    expect({
      absent: status(manifestWith(undefined)),
      valid: status(manifestWith(check)),
      "no timeout": status(manifestWith({ command: "mvn -q test", inputs: ["pom.xml"] })),
      "empty command": status(manifestWith({ ...check, command: " " })),
      "empty inputs": status(manifestWith({ ...check, inputs: [] })),
      "parent path": status(manifestWith({ ...check, inputs: ["../rules"] })),
      "unknown field": status(manifestWith({ ...check, rules: "strict" })),
      "zero timeout": status(manifestWith({ ...check, timeout_sec: 0 })),
      render: await preserved("render"),
      upgrade: await preserved("upgrade"),
    }).toEqual({
      absent: "disabled",
      valid: "enabled",
      "no timeout": "enabled",
      "empty command": "invalid",
      "empty inputs": "invalid",
      "parent path": "invalid",
      "unknown field": "invalid",
      "zero timeout": "invalid",
      render: "preserved",
      upgrade: "preserved",
    });
  });

  it("reads an optional root git block of exact names, and keeps it through upgrade", async () => {
    const withGit = (git: unknown) => ({ schemaVersion: 1, mode: "prep", repos: [repo], git });
    const status = (git: unknown) => {
      const r = parseManifest(withGit(git));
      return r.ok ? JSON.stringify(r.manifest.git) : r.detail;
    };
    const text = `schemaVersion: 1\nmode: prep\ngit: # main and extra protected refs\n  default_branch: trunk\n  protected_refs: ["refs/heads/release"]\n${renderManifest(
      "prep",
      { path: ".", ...repo },
    )
      .split("\n")
      .slice(4)
      .join("\n")}`;
    const upgraded = await upgradeManifestText(text, {
      tests: ["**/vite.config.*"],
      ignore: [],
      e2e: [],
      roles: null,
    });
    const back = parseManifest(parse(upgraded));
    expect({
      both: status({
        default_branch: "main",
        protected_refs: ["refs/heads/release", "refs/tags/v1"],
      }),
      "branch only": status({ default_branch: "trunk" }),
      "full ref as branch": status({ default_branch: "refs/heads/main" }),
      "pattern ref": status({ protected_refs: ["refs/heads/release/*"] }),
      "short ref": status({ protected_refs: ["release"] }),
      "option-like": status({ default_branch: "-x" }),
      "unknown key": status({ disable: true }),
      upgrade: back.ok ? JSON.stringify(back.manifest.git) : back.detail,
      "comment kept": upgraded.includes("# main and extra protected refs"),
    }).toEqual({
      both: '{"default_branch":"main","protected_refs":["refs/heads/release","refs/tags/v1"]}',
      "branch only": '{"default_branch":"trunk"}',
      "full ref as branch": "git.default_branch: must be a short branch name such as main",
      "pattern ref": "git.protected_refs.0: must be a full exact ref such as refs/heads/release",
      "short ref": "git.protected_refs.0: must be a full exact ref such as refs/heads/release",
      "option-like": "git.default_branch: must be a short branch name such as main",
      "unknown key": "git: unknown key disable",
      upgrade: '{"default_branch":"trunk","protected_refs":["refs/heads/release"]}',
      "comment kept": true,
    });
  });

  it("adds the missing defaults, keeping comments and the developer's entries, test_cmd included", async () => {
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
        architecture: "ddd",
        schemaVersion: 1,
        mode: "remix",
        drive: "human",
        layout: "monorepo",
        providers: ["claude-code"],
        allowed_skills: [],
        allowed_agents: [],
        roles: { reviewer: ["verid:reviewer"], tester: ["verid:tester"], coder: ["verid:coder"] },
        repos: [
          {
            path: ".",
            test_cmd: "npx vitest run --reporter=junit --outputFile={junit}",
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
