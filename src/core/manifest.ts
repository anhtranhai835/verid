import * as z from "zod/mini";
import { durationDays, isCalendarDate, WEEKDAYS } from "./iterations.js";

// zod/mini ships no messages ("Invalid input"), so the ones a developer needs are spelled out.
const nonEmpty = { error: "must not be empty" };
// What core/glob.ts cannot match: braces, classes, negation, absolute or parent paths. Such a
// glob would match nothing and silently switch the gate off, so it is refused up front.
const UNSUPPORTED_GLOB = /[{}[\]]|^[!/\\]|^[a-z]:|(^|[/\\])\.\.([/\\]|$)/i;
// So would a folder (`src`, `src/`): globs match file paths, and a path never ends in a slash.
// A name with no wildcard and no dot reads as a folder; a file such as Makefile is `**/Makefile`.
const namesFolder = (g: string) =>
  /[/\\]$/.test(g) || (!/[*?]/.test(g) && !(g.split(/[/\\]/).pop() ?? "").includes("."));
const glob = z.string().check(
  z.minLength(1, nonEmpty),
  z.refine((g) => !UNSUPPORTED_GLOB.test(g), {
    error: "only **, * and ? are supported, relative to the repo path",
  }),
  z.refine((g) => !g.includes(","), {
    error: "holds a comma: give each glob as its own list item",
  }),
  z.refine((g) => !namesFolder(g), {
    error: "names a folder, which matches no file: add /** for everything in it",
  }),
);

/** A portable repo path; aliases and ambiguous Windows spellings fail closed. */
export const repoPathKey = (path: string): string => path.replaceAll("\\", "/").toLowerCase();
const normalizeRepoPath = (path: string): string =>
  path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/") || ".";
const safeRepoPath = (path: string): boolean =>
  path === "." ||
  path
    .split(/[/\\]/)
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !/[<>:"|?*~\x00-\x1f]/.test(part) &&
        !/[. ]$/.test(part) &&
        !/^\s/.test(part) &&
        !/^\.(git|verid|claude)$/i.test(part) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );
const gitValue = z.string().check(
  z.minLength(1, nonEmpty),
  z.refine((value) => value.trim() !== "" && !/^[-\s]|[\x00-\x1f]/.test(value), {
    error: "must be a non-empty git value, not an option",
  }),
);
/** Local paths are allowed, but network file shares and git options are never clone inputs. */
export const safeCloneRemote = (value: string): boolean =>
  value.trim() !== "" &&
  !/^[-\s]|[\x00-\x1f]/.test(value) &&
  !/^[/\\]{2}/.test(value) &&
  !/^file:\/\/[^/]|^file:\/{4}/i.test(value.replaceAll("\\", "/"));
const repo = z.strictObject({
  path: z._default(
    z
      .pipe(
        z.string().check(
          z.refine((path) => path !== "" && !/^[/\\]|^[a-z]:/i.test(path), {
            error: "must be a non-empty relative repo path",
          }),
        ),
        z.transform(normalizeRepoPath),
      )
      .check(z.refine(safeRepoPath, { error: "must be an unambiguous relative repo path" })),
    ".",
  ),
  remote: z.optional(
    gitValue.check(z.refine(safeCloneRemote, { error: "must not name a network file share" })),
  ),
  default_branch: z.optional(gitValue),
  role: z.optional(z.enum(["frontend", "backend", "e2e", "other"])),
  // {junit} is replaced by the quoted path; runners set up through an environment variable
  // read the same path from VERID_JUNIT (cmd.exe keeps quotes in `set VAR="..."`). Without it,
  // verid finds the runners from the build files (core/runners.ts).
  test_cmd: z.optional(
    z.string().check(
      z.refine((cmd) => cmd.includes("{junit}") || cmd.includes("VERID_JUNIT"), {
        error: "must contain {junit} or VERID_JUNIT, where the JUnit report goes",
      }),
    ),
  ),
  source_globs: z.array(glob).check(z.minLength(1, nonEmpty)),
  test_globs: z.array(glob).check(z.minLength(1, nonEmpty)),
  ignore_globs: z.optional(z.array(glob)),
  // Tests there are end-to-end: they alone cover an `(e2e)` AC (core/tdd.ts e2eCases).
  e2e_globs: z.optional(z.array(glob)),
  timeout_sec: z.optional(z.int().check(z.positive())),
  // A project-owned structural check (ArchUnit, dependency-cruiser, Import Linter) run by
  // `verid taste`; a module closes only on its fresh pass. Inputs add its rules, config and lock
  // files to the code and tests its freshness covers; absent, nothing changes.
  architecture_check: z.optional(
    z.strictObject({
      command: z.string().check(z.refine((cmd) => cmd.trim() !== "", nonEmpty)),
      inputs: z.array(glob).check(z.minLength(1, nonEmpty)),
      timeout_sec: z.optional(z.int().check(z.positive())),
    }),
  ),
});

// Under the 2-minute default of Claude Code's Bash tool, so a hung run is stopped and
// explained by verid rather than cut off by Claude Code.
export const DEFAULT_TIMEOUT_SEC = 100;

export const MODES = ["prep", "recipe", "remix"] as const;
export type Mode = (typeof MODES)[number];
export const PROVIDERS = ["claude-code", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];

const allowedName = z.string().check(
  z.minLength(1, nonEmpty),
  z.refine((value) => !/[\s*\x00-\x1f]/.test(value), {
    error: "must be an exact name without whitespace or wildcards",
  }),
);
const allowedSkill = z.string().check(
  z.minLength(1, nonEmpty),
  z.refine(
    (value) => !/[\s\x00-\x1f]/.test(value) && (!value.includes("*") || /^[^*]+:\*$/.test(value)),
    {
      error: "must be an exact skill name or prefix:* without whitespace",
    },
  ),
);

export const ROLE_NAMES = [
  "reviewer",
  "tester",
  "coder",
  "researcher",
  "architect",
  "planner",
  "qa",
  "security",
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Who moves the project through the cycle: the developer, or the mapped agents on their own. */
export const DRIVES = ["human", "auto"] as const;
export type Drive = (typeof DRIVES)[number];

export const LAYOUTS = ["monorepo", "workspace"] as const;
export type Layout = (typeof LAYOUTS)[number];

const agentList = z
  .array(z.string().check(z.minLength(1, nonEmpty)))
  .check(z.minLength(1, nonEmpty));
// Agent types as Claude Code reports them in a subagent's payload. One agent holds one role, and
// the tester and the coder come together: with one of them only, nobody could write the other.
const roles = z
  .strictObject({
    reviewer: z.optional(agentList),
    tester: z.optional(agentList),
    coder: z.optional(agentList),
    researcher: z.optional(agentList),
    architect: z.optional(agentList),
    planner: z.optional(agentList),
    qa: z.optional(agentList),
    security: z.optional(agentList),
  })
  .check(
    z.superRefine((r, ctx) => {
      const seen = new Map<string, RoleName>();
      for (const role of ROLE_NAMES)
        for (const name of r[role] ?? []) {
          const other = seen.get(name);
          if (other)
            return ctx.addIssue({
              code: "custom",
              message: `${name} is both ${other} and ${role}`,
            });
          seen.set(name, role);
        }
      if (!r.tester !== !r.coder)
        ctx.addIssue({ code: "custom", message: "tester and coder go together" });
    }),
  );

const iterations = z
  .strictObject({
    duration: z.string().check(
      z.refine((value) => durationDays(value) !== null, {
        error: "must be a positive integer followed by days or weeks",
      }),
    ),
    start_date: z.string().check(
      z.refine(isCalendarDate, {
        error: "must be a real date in YYYY-MM-DD format",
      }),
    ),
    demo_day: z.enum(WEEKDAYS, { error: "must be Monday through Sunday" }),
  })
  .check(
    z.superRefine((settings, ctx) => {
      const days = durationDays(settings.duration);
      if (days === null || !isCalendarDate(settings.start_date)) return;
      const end = Date.parse(`${settings.start_date}T00:00:00Z`) + (days - 1) * 86_400_000;
      if (!Number.isFinite(new Date(end).getTime()))
        ctx.addIssue({
          code: "custom",
          path: ["duration"],
          message: "exceeds the supported date range",
        });
    }),
  );

/** Unknown keys are rejected rather than ignored. */
const manifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    // A manifest written before modes existed gets told what to add, not "Invalid input".
    mode: z.enum(MODES, { error: "must be prep, recipe or remix" }),
    providers: z._default(
      z.array(z.enum(PROVIDERS, { error: "must be claude-code or codex" })).check(
        z.minLength(1, nonEmpty),
        z.refine((values) => new Set(values).size === values.length, {
          error: "must not repeat a provider",
        }),
      ),
      ["claude-code"],
    ),
    allowed_skills: z._default(z.array(allowedSkill), []),
    allowed_agents: z._default(z.array(allowedName), []),
    roles: z.optional(roles),
    drive: z._default(z.enum(DRIVES, { error: "must be human or auto" }), "human"),
    layout: z._default(z.enum(LAYOUTS, { error: "must be monorepo or workspace" }), "monorepo"),
    iterations: z.optional(iterations),
    repos: z.array(repo).check(z.minLength(1, nonEmpty)),
  })
  .check(
    // Auto walks the plan module by module, which remix has none of, and with no developer to
    // fill in, a role left unmapped would leave a step with no one to take it.
    z.superRefine((m, ctx) => {
      const paths: string[] = [];
      for (const [i, repo] of m.repos.entries()) {
        const path = repoPathKey(repo.path);
        if (
          (m.layout === "workspace" && path === ".") ||
          paths.some(
            (other) =>
              path === other ||
              path === "." ||
              other === "." ||
              path.startsWith(`${other}/`) ||
              other.startsWith(`${path}/`),
          )
        )
          return ctx.addIssue({
            code: "custom",
            path: ["repos", i, "path"],
            message:
              "repo roots must be distinct, non-overlapping folders; workspace roots must be children",
          });
        paths.push(path);
      }
      if (m.iterations && m.mode === "remix")
        return ctx.addIssue({
          code: "custom",
          path: ["iterations"],
          message: "needs mode prep or recipe",
        });
      if (m.drive !== "auto") return;
      if (m.mode === "remix")
        return ctx.addIssue({
          code: "custom",
          path: ["drive"],
          message: "auto needs mode prep or recipe",
        });
      if (
        !m.roles?.reviewer ||
        (m.providers.includes("claude-code") && (!m.roles.tester || !m.roles.coder))
      )
        ctx.addIssue({
          code: "custom",
          path: ["drive"],
          message: "auto needs roles reviewer, tester and coder",
        });
    }),
  );

export type Manifest = z.infer<typeof manifestSchema>;
export type Iterations = NonNullable<Manifest["iterations"]>;
export type Roles = NonNullable<Manifest["roles"]>;

/** The agents `verid cook` maps: verid's own, from its plugin. Any agent can take their place. */
export const DEFAULT_ROLES: Roles = {
  reviewer: ["verid:reviewer"],
  tester: ["verid:tester"],
  coder: ["verid:coder"],
  researcher: ["verid:researcher"],
  architect: ["verid:architect"],
  planner: ["verid:planner"],
  qa: ["verid:qa"],
  security: ["verid:security"],
};

/** What cook maps for these providers. On Codex alone the reviewer also checks security. */
export function defaultRoles(providers: readonly Provider[]): Roles {
  const { security: _, ...codexOnly } = DEFAULT_ROLES;
  return providerRoles(providers.includes("claude-code") ? DEFAULT_ROLES : codexOnly, providers)!;
}

/** Keep Claude mappings while registering the user-layer Codex reviewer. */
export function providerRoles(
  roles: Roles | undefined,
  providers: readonly Provider[],
): Roles | undefined {
  if (!providers.includes("codex")) return roles;
  return { ...roles, reviewer: [...new Set([...(roles?.reviewer ?? []), "verid_reviewer"])] };
}

export type ParseManifestResult = { ok: true; manifest: Manifest } | { ok: false; detail: string };

/** Validates the parsed YAML document. */
export function parseManifest(doc: unknown): ParseManifestResult {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc))
    return { ok: false, detail: "expected a YAML mapping" };
  // Never guess the shape of a version we do not know.
  if ((doc as { schemaVersion?: unknown }).schemaVersion !== 1)
    return { ok: false, detail: "schemaVersion must be 1" };
  const r = manifestSchema.safeParse(doc);
  if (r.success) return { ok: true, manifest: r.data };
  const issue = r.error.issues[0];
  if (!issue) return { ok: false, detail: "invalid" };
  const where = issue.path.join(".") || "manifest";
  const what =
    issue.code === "unrecognized_keys"
      ? `unknown key ${issue.keys.join(", ")}`
      : issue.code === "invalid_type"
        ? `expected ${issue.expected}`
        : issue.message;
  return { ok: false, detail: `${where}: ${what}` };
}

/** What `verid cook` found in the project. */
export interface ProjectFacts {
  /** The first of src/, lib/, app/ that exists. */
  sourceDir?: string | undefined;
}

/** `verid cook --test-cmd ... --src ... --tests ...`; each flag replaces what was recognised. */
export interface InitFlags {
  testCmd?: string | undefined;
  src: readonly string[];
  tests: readonly string[];
  /** Added to the files that are never production code. */
  ignore?: readonly string[];
  /** As typed on the command line; the caller checks it against MODES. */
  mode?: string | undefined;
  /** As typed on the command line; the caller checks it against DRIVES. */
  drive?: string | undefined;
  /** As typed; an existing manifest keeps its chosen layout. */
  layout?: string | undefined;
  /** Repeatable --provider; an existing manifest keeps its developer's selection. */
  providers?: readonly string[] | undefined;
  /** Optional calendar planning for prep and recipe; never changes module order or gates. */
  iterations?: boolean | undefined;
  duration?: string | undefined;
  startDate?: string | undefined;
  demoDay?: string | undefined;
  /** As typed: the language for this machine's messages, vi or en; the caller checks it. */
  lang?: string | undefined;
  /**
   * An existing manifest: true adds the defaults it lacks (manifestUpgrade), false keeps it as
   * the developer answered, and unset (no terminal to ask in) lists them in a note.
   */
  upgrade?: boolean;
  /** Preview only, without caches or other project writes. */
  dryRun?: boolean | undefined;
  /** Accept suggested choices and manifest defaults without prompting. */
  yes?: boolean | undefined;
}

export type Repo = Manifest["repos"][number];

/**
 * Tests by the conventions of the common languages: Maven and Gradle keep them under src/test,
 * Go and Python name them, C# puts them in a *.Tests project. Runner config can deselect tests,
 * so it counts as a test. Names like FooTest.java are left out: matching ignores case, and
 * latest.js would be a test.
 */
/** Where end-to-end tests go by default: an e2e folder, or a `.e2e.` in the file name. */
export const E2E_GLOBS = ["**/e2e/**", "**/*.e2e.*"];

export const TEST_GLOBS = [
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

/**
 * Never production code: documents, data and config (tool config written in code, such as
 * eslint.config.js, and dotfiles too), the build and dependency files a library is added to,
 * the files that set a project up (Dockerfile, Makefile, the Gradle and Maven wrappers), web
 * assets, and folders tools write or own. No test can be written for these, so locking them
 * would stop the agent from setting a project up. Secret files stay blocked by their own rule.
 */
export const IGNORE_GLOBS = [
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

/** Code already there is remixed; an empty project is prepped. recipe is never guessed. */
export function suggestMode(facts: ProjectFacts): "prep" | "remix" {
  return facts.sourceDir ? "remix" : "prep";
}

/**
 * The single repo `verid cook` would write. Every file but the tests and the ignored ones is
 * production code, whatever the language, so there is no folder to pick: code written anywhere
 * later is locked too. Without --test-cmd, verid finds the test runners at each run.
 */
export function suggestManifest(flags: InitFlags): Repo {
  return {
    path: ".",
    ...(flags.testCmd !== undefined && { test_cmd: flags.testCmd }),
    source_globs: flags.src.length > 0 ? [...flags.src] : ["**"],
    test_globs: flags.tests.length > 0 ? [...flags.tests] : [...TEST_GLOBS],
    ignore_globs: [...IGNORE_GLOBS, ...(flags.ignore ?? [])],
    e2e_globs: [...E2E_GLOBS],
  };
}

/** The manifest as YAML; strings and lists are written as JSON, which YAML reads as is. */
export function renderManifest(
  mode: Mode,
  repo: Repo | readonly Repo[],
  roles?: Roles,
  drive?: Drive,
  layout: Layout = "monorepo",
  iterations?: Iterations,
  providers: readonly Provider[] = ["claude-code"],
): string {
  const repos: readonly Repo[] = Array.isArray(repo) ? repo : [repo as Repo];
  return [
    "# verid manifest: only the developer edits this file. Commit it with the project.",
    "schemaVersion: 1",
    `mode: ${JSON.stringify(mode)} # ${MODES.join(" | ")}`,
    `providers: ${JSON.stringify(providers)} # claude-code | codex`,
    "allowed_skills: [] # additional exact names or prefix:*; verid:*, superpowers:*, andrej-karpathy-skills:* are always allowed",
    'allowed_agents: ["general-purpose"] # superpowers dispatches; roles are always allowed',
    ...(layout === "workspace" ? ['layout: "workspace" # monorepo | workspace'] : []),
    // human is the default, so only auto is written.
    ...(drive === "auto" ? [`drive: ${JSON.stringify(drive)} # ${DRIVES.join(" | ")}`] : []),
    ...(iterations
      ? [
          "iterations:",
          `  duration: ${JSON.stringify(iterations.duration)}`,
          `  start_date: ${JSON.stringify(iterations.start_date)}`,
          `  demo_day: ${JSON.stringify(iterations.demo_day)}`,
        ]
      : []),
    ...(roles
      ? [
          "roles: # agent types Claude Code reports, from the verid plugin; any agent can fill a role",
        ]
      : []),
    ...ROLE_NAMES.flatMap((r) => (roles?.[r] ? [`  ${r}: ${JSON.stringify(roles[r])}`] : [])),
    "repos:",
    ...repos.flatMap((repo) => [
      `  - path: ${JSON.stringify(repo.path)}`,
      ...(repo.remote ? [`    remote: ${JSON.stringify(repo.remote)}`] : []),
      ...(repo.default_branch
        ? [`    default_branch: ${JSON.stringify(repo.default_branch)}`]
        : []),
      ...(repo.role ? [`    role: ${JSON.stringify(repo.role)}`] : []),
      repo.test_cmd === undefined
        ? "    # test_cmd: verid finds the test runner from the build files; set one to choose it"
        : `    test_cmd: ${JSON.stringify(repo.test_cmd)}`,
      `    source_globs: ${JSON.stringify(repo.source_globs)}`,
      `    test_globs: ${JSON.stringify(repo.test_globs)}`,
      ...(repo.ignore_globs ? [`    ignore_globs: ${JSON.stringify(repo.ignore_globs)}`] : []),
      ...(repo.e2e_globs ? [`    e2e_globs: ${JSON.stringify(repo.e2e_globs)}`] : []),
      ...(repo.timeout_sec ? [`    timeout_sec: ${repo.timeout_sec}`] : []),
      ...(repo.architecture_check
        ? [`    architecture_check: ${JSON.stringify(repo.architecture_check)}`]
        : []),
    ]),
    "",
  ].join("\n");
}

/** The test commands older verid wrote for a runner it found; verid now finds the runner itself. */
const OLD_PRESETS = [
  "npx vitest run --reporter=junit --outputFile={junit}",
  "python -m pytest --junitxml={junit}",
];

/**
 * What `verid cook` offers a manifest written by an older verid: the default test and ignore
 * globs it lacks, missing optional roles (all roles when it maps none), and dropping a test_cmd
 * that is only the runner preset of the time. The developer's own entries stay.
 */
export function manifestUpgrade(
  repo: Repo,
  roles?: Roles,
  providers: readonly Provider[] = ["claude-code"],
): {
  tests: string[];
  ignore: string[];
  e2e: string[];
  roles: Roles | null;
  dropTestCmd: boolean;
} {
  const ignored = repo.ignore_globs ?? [];
  // Test globs the developer chose (--tests) share none with the defaults: they stay as chosen.
  const ownTests = !repo.test_globs.some((g) => TEST_GLOBS.includes(g));
  const used = new Set(Object.values(roles ?? {}).flat());
  const claude = providers.includes("claude-code");
  const { security: _, ...codexOnly } = DEFAULT_ROLES;
  const added: Roles =
    roles === undefined
      ? claude
        ? DEFAULT_ROLES
        : codexOnly
      : Object.fromEntries(
          (
            [
              "researcher",
              "architect",
              "planner",
              "qa",
              ...(claude ? (["security"] as const) : []),
            ] as const
          ).flatMap((role) => {
            const agents = DEFAULT_ROLES[role];
            return !roles[role] && agents && !agents.some((name) => used.has(name))
              ? [[role, agents]]
              : [];
          }),
        );
  return {
    tests: ownTests ? [] : TEST_GLOBS.filter((g) => !repo.test_globs.includes(g)),
    ignore: IGNORE_GLOBS.filter((g) => !ignored.includes(g)),
    // e2e_globs the developer wrote stay as written.
    e2e: repo.e2e_globs === undefined ? [...E2E_GLOBS] : [],
    // Roles the developer mapped stay as mapped.
    roles: Object.keys(added).length > 0 ? added : null,
    dropTestCmd: repo.test_cmd !== undefined && OLD_PRESETS.includes(repo.test_cmd),
  };
}
