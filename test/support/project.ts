import { parse as parseYaml, stringify } from "yaml";
import { readState, statePaths } from "../../src/adapters/state-store.js";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { defaultRoles } from "../../src/core/manifest.js";
import { readJUnit } from "../../src/adapters/junit.js";
import { parsePlan } from "../../src/core/plan.js";
import { MODULE_INPUTS, readPlan } from "../../src/adapters/plan-file.js";
import { runCli, runHook, runReview } from "../e2e/in-process.js";

/**
 * A developer's terminal: this process's environment without CLAUDE_* variables, so the test
 * machine's own session leaks nothing. Variables starting with an `also` prefix go too.
 */
export const developerEnv = (...also: string[]): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !["CLAUDE", ...also].some((prefix) => key.startsWith(prefix)),
    ),
  );

/** Real Claude Code hook stdin, recorded once, with {{CWD}}, {{HOME}} and {{SESSION_ID}} placeholders. */
export const CLAUDE_FIXTURES = join(import.meta.dirname, "..", "fixtures", "claude-code");
export const FIXTURE_SESSION = "11111111-2222-3333-4444-555555555555";
export type Payload = Record<string, any>;
const esc = (s: string) => JSON.stringify(s).slice(1, -1);

/** A recorded payload with its placeholders filled for `project`, then edited by the test. */
export function claudeFixture(project: string, name: string, edit?: (p: Payload) => void): string {
  const text = readFileSync(join(CLAUDE_FIXTURES, `${name}.json`), "utf8")
    // A replacer function: a string replacement would turn the `$$` in a project path into `$`.
    .replaceAll("{{CWD}}", () => esc(project))
    .replaceAll("{{HOME}}", esc(homedir()))
    .replaceAll("{{SESSION_ID}}", FIXTURE_SESSION)
    .replaceAll(/\{\{[A-Z_]+\}\}/g, "placeholder");
  const payload = JSON.parse(text) as Payload;
  edit?.(payload);
  return JSON.stringify(payload);
}

/** Legacy feature fixtures still exercise real dossier hashing and approval gates in v2. */
export function readyModulePlan(project: string, text: string): string {
  const parsed = parsePlan(text);
  if (!parsed.ok) return text;
  for (const module of parsed.modules) {
    const base = `.verid/artifacts/03-modules/${module.name}`;
    for (const input of MODULE_INPUTS) {
      const file = join(project, base, input);
      mkdirSync(join(file, ".."), { recursive: true });
      if (!existsSync(file) || readFileSync(file, "utf8").includes("[NEEDS CLARIFICATION"))
        writeFileSync(file, `Agreed ${module.name}: ${input}\n`);
    }
    if (!/^Artifacts:/m.test(module.text)) {
      const section =
        module.text + (module.text.endsWith("\n") ? "" : "\n") + `Artifacts: ${base}\n`;
      text = text.replace(module.text, () => section);
    }
  }
  return text;
}

export function moduleHash(project: string, name: string): string {
  const plan = readPlan(project, false, true);
  if (!plan?.ok || !plan.hashes[name]) throw new Error(`invalid fixture module: ${name}`);
  return plan.hashes[name];
}

/** A real startup after terminal order, never a fabricated session claim in state. */
export function startTaskSession(
  project: string,
  session = FIXTURE_SESSION,
  provider = "claude-code",
) {
  if (provider === "antigravity")
    return runHook(
      JSON.stringify({ conversationId: session, workspacePaths: [project], source: "startup" }),
      {},
      ["--provider", "antigravity", "--event", "SessionStart"],
    );
  return runHook(
    JSON.stringify({
      hook_event_name: "SessionStart",
      cwd: project,
      session_id: session,
      source: "startup",
      model: "test",
      transcript_path: null,
      permission_mode: "default",
    }),
    {},
    provider === "claude-code" ? [] : ["--provider", provider],
  );
}

export const TEST_ROOT = join(import.meta.dirname, "../..");
export const CLI = join(TEST_ROOT, "dist/cli.js");
export const HOOK = join(TEST_ROOT, "dist/hook.js");
export const RUNNER = join(import.meta.dirname, "../e2e/fake-runner.mjs");
export const FRESH_STATE = '{"schemaVersion":1,"baseline":[]}';

export const manifest = (
  sourceGlob = "src/**",
  testCmd = `"${process.execPath}" "${RUNNER}" {junit}`,
  repoPath = ".",
  mode = "remix",
  header: string[] = [],
  repoExtra: string[] = [],
) =>
  [
    "schemaVersion: 1",
    `mode: ${mode}`,
    ...header,
    "repos:",
    `  - path: ${repoPath}`,
    `    test_cmd: ${JSON.stringify(testCmd)}`,
    `    source_globs: ["${sourceGlob}"]`,
    '    test_globs: ["test/**"]',
    ...repoExtra,
    "",
  ].join("\n");

export const autoManifest = (testCmd?: string) =>
  manifest("src/**", testCmd, ".", "prep", [
    "drive: auto",
    "roles:",
    '  reviewer: ["verid:reviewer"]',
    '  tester: ["verid:tester"]',
    '  coder: ["verid:coder"]',
  ]);
export const SRC_TEST = '    source_globs: ["src/**"]\n    test_globs: ["test/**"]';
export const architectureManifest = (
  check: Record<string, unknown> | null,
  mode = "remix",
  extra = 'roles:\n  reviewer: ["verid:reviewer"]\n',
  globs = SRC_TEST,
) =>
  manifest(
    "src/**",
    undefined,
    ".",
    mode,
    mode === "remix" ? [] : [extra.trimEnd()],
    check ? [`    architecture_check: ${JSON.stringify(check)}`] : [],
  ).replace(SRC_TEST, globs);

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type GitResult = SpawnSyncReturns<string>;
export const verdict = (r: Run) =>
  r.code === 0 ? "exit 0" : /verid \[(\w+)\]/.exec(r.stderr)?.[1];
let english: Record<string, string> | undefined;
export const enMessage = (key: string, params: Record<string, string>) => {
  english ??= JSON.parse(readFileSync(join(TEST_ROOT, "i18n/en.json"), "utf8"));
  return (english![key] ?? key).replace(
    /\{(\w+)\}/g,
    (match, name: string) =>
      params[name] ?? (name === "verid" ? `node "${CLI.replaceAll("\\", "/")}"` : match),
  );
};
export const told = (r: Run | undefined, key: string, params: Record<string, string>) =>
  r?.code === 0 &&
  String((JSON.parse(r.stdout || "{}") as Payload).systemMessage).includes(enMessage(key, params));

interface ProjectFiles {
  readonly root: string;
  readonly dir: string;
  readonly stateFile: string;
  readonly auditFile: string;
  readonly manifestFile: string;
  readonly lockFile: string;
  path(rel: string): string;
}

interface ProjectOptions {
  subdir?: string;
  cwd?: () => string;
  state?: string | object;
  manifest?: string | (() => string);
  bind?: (project: ProjectFiles) => void;
  setup?: (project: ProjectFiles) => void;
  teardown?: () => void | Promise<void>;
  env?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
  omitEnv?: string[];
  claudeProject?: boolean;
  review?: boolean;
  session?: string;
  taskSession?: boolean;
  sessionChanged?: (session: string) => void;
  cleanup?: { maxRetries?: number; retryDelay?: number };
  parents?: boolean;
  gitIdentity?: readonly [string, string] | false;
  gitEnv?: () => NodeJS.ProcessEnv;
  gitHide?: boolean;

  sessionId?: () => string;
  gitPrefix?: string;
  readyPlan?: boolean;
  planSpec?: string;
  defaultText?: string;
  provider?: string;
  payload?: Payload;
  cliEnv?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
  manifestPreset?: "plain" | "codex" | "review" | "antigravity";
  hookEnv?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
  approved?: boolean;
}

export interface TestProject extends ProjectFiles {
  installedHook: (event: string, extra?: Payload) => SpawnSyncReturns<string>;
  gitManifest: (extra?: string, repos?: string) => void;
  contextSetup: (language?: string, extra?: Payload) => void;
  startSession: (source: string, provider?: string) => ReturnType<typeof runHook>;
  payloadFor: (event: string, session: string, extra?: Payload) => string;
  newDir: () => string;
  hookArgs: (input: string, args?: string[]) => ReturnType<typeof runHook>;
  readonly session: string;
  path: (rel: string) => string;
  put: (rel: string, text?: string) => void;
  read: (rel: string) => string;
  state: () => Payload;
  audit: () => Payload[];
  seed: (partial: Payload) => void;
  env: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  fixture: (name: string, edit?: (p: Payload) => void) => string;
  write: (rel: string, agent?: string) => string;
  readTool: (rel: string) => string;
  hook: (input: string, extra?: NodeJS.ProcessEnv, args?: string[]) => ReturnType<typeof runHook>;
  hookSync: (input: string, extra?: NodeJS.ProcessEnv, args?: string[]) => Run;
  hookAsync: (input: string) => Promise<Run>;
  reviewStop: (type: string) => (report: string) => ReturnType<typeof runHook>;
  coderStop: (active: boolean) => ReturnType<typeof runHook>;
  stop: (active?: boolean) => ReturnType<typeof runHook>;
  actorWrite: (agent: string, rel: string) => Promise<ReturnType<typeof verdict>>;
  gitRaw: (...args: string[]) => GitResult;
  gitChecked: (check: (result: GitResult) => void) => (...args: string[]) => void;
  cliWith: (extra: NodeJS.ProcessEnv, ...args: string[]) => ReturnType<typeof runCli>;
  cli: (...args: string[]) => ReturnType<typeof runCli>;
  reset: () => void;
  fresh: () => void;
  putPlan: (rel: string, text?: string) => void;
  putAt: (dir: string, rel: string, text?: string) => void;
  putFile: (file: string, text: string) => void;
  readAt: (dir: string, rel: string) => string;
  readFile: (file: string) => string;
  manifestText: () => string;
  editManifest: (edit: (value: Payload) => void) => void;
  objectManifest: (extra?: Payload) => Payload;
  writeManifest: (extra?: Payload) => void;
  manifestForDrive: (drive?: string) => Payload;
  loadState: () => ReturnType<typeof readState>;
  auditText: () => string;
  providerHook: (
    payload: unknown,
    provider?: string,
    extra?: NodeJS.ProcessEnv,
  ) => ReturnType<typeof runHook>;
  inputHook: (
    payload: Payload,
    attended?: boolean,
    configDir?: string,
  ) => ReturnType<typeof runHook>;
  guardHook: (
    payload: Payload,
    attended?: boolean,
    configDir?: string,
  ) => Promise<{ code: number; stderr: string }>;
  event: (event: string, extra?: Payload) => ReturnType<typeof runHook>;
  sessionEvent: (
    event: string,
    session: string,
    extra?: Payload,
    provider?: string,
  ) => ReturnType<typeof runHook>;
  writeCall: (path: string) => ReturnType<typeof runHook>;
  pathHook: (
    path: string,
    writer?: string,
    tool?: string,
    input?: object,
  ) => Promise<{ code: number; err: string }>;
  gitRawAt: (cwd: string, ...args: string[]) => GitResult;
  gitAt: (cwd: string, ...args: string[]) => string;
  cliAt: (args: string[], cwd?: string, extra?: NodeJS.ProcessEnv) => ReturnType<typeof runCli>;
  cliBound: (...args: string[]) => ReturnType<typeof runCli>;
  shortCliAt: (
    args: string[],
    cwd?: string,
    extra?: NodeJS.ProcessEnv,
  ) => Promise<{ code: number; out: string; err: string }>;
  shortCliArgs: (
    args: string[],
    extra?: NodeJS.ProcessEnv,
  ) => Promise<{ code: number; out: string; err: string }>;
  rawCliFile: (entry: string, ...args: string[]) => SpawnSyncReturns<string>;
  rawCli: (args: string[]) => SpawnSyncReturns<string>;
  rawCliArgs: (...args: string[]) => SpawnSyncReturns<string>;
  spawnCliAt: (cwd: string, ...args: string[]) => Run;
  spawnCook: (cwd: string, ...args: string[]) => Run;
  spawnCookWith: (env: NodeJS.ProcessEnv, cwd: string, ...args: string[]) => Run;
  shortSpawnArgs: (
    args: string[],
    extra?: NodeJS.ProcessEnv,
  ) => { code: number | null; out: string; err: string };
  settingsHook: (cwd: string, event: string, input: string) => Run;
}

/** Calls into in-process.ts share process state: keep a file's tests and calls sequential. */
export function tempProject(prefix: string, options: ProjectOptions = {}) {
  const roots: string[] = [];
  let root: string;
  let dir: string;
  let session = options.session ?? FIXTURE_SESSION;
  let sessionCount = 0;
  const callEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...(options.claudeProject === false ? {} : { CLAUDE_PROJECT_DIR: project.dir }),
    ...(typeof options.env === "function" ? options.env() : options.env),
    ...extra,
  });
  const project: TestProject = {
    installedHook: (event: string, extra: Payload = {}): SpawnSyncReturns<string> =>
      spawnSync(process.execPath, [project.path(".verid/hooks/hook.js"), "--provider", "codex"], {
        cwd: project.dir,
        env: project.env(),
        encoding: "utf8",
        input: JSON.stringify({
          hook_event_name: event,
          session_id: options.sessionId?.() ?? project.session,
          cwd: project.dir,
          ...options.payload,
          ...extra,
        }),
      }),
    gitManifest: (
      extra = "",
      repos = '  - path: "."\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
    ): void =>
      project.put(
        ".verid/manifest.yaml",
        "schemaVersion: 1\nmode: prep\n" + extra + "repos:\n" + repos,
      ),
    contextSetup: (language = "en", extra: Payload = {}): void => {
      project.put(
        ".verid/manifest.yaml",
        stringify({
          schemaVersion: 1,
          mode: "prep",
          providers: ["claude-code"],
          roles: defaultRoles(["claude-code"]),
          repos: [{ path: ".", source_globs: ["src/**"], test_globs: ["test/**"] }],
          ...extra,
        }),
      );
      project.put(".verid/.state/state.json", JSON.stringify({ schemaVersion: 1, language }));
    },
    startSession: (source: string, provider = "claude-code"): ReturnType<typeof runHook> =>
      project.sessionEvent("SessionStart", project.session, { source }, provider),
    payloadFor: (event: string, session: string, extra: Payload = {}): string =>
      JSON.stringify({
        hook_event_name: event,
        cwd: project.dir,
        session_id: session,
        ...options.payload,
        ...extra,
      }),
    get root() {
      return root;
    },
    get dir() {
      return options.cwd?.() ?? dir;
    },
    get stateFile() {
      return project.path(".verid/.state/state.json");
    },
    get auditFile() {
      return project.path(".verid/.state/audit.jsonl");
    },
    get manifestFile() {
      return project.path(".verid/manifest.yaml");
    },
    get lockFile() {
      return project.path(".verid/.state/state.lock");
    },
    get session() {
      return session;
    },
    path: (rel: string): string => join(project.dir, ...rel.split("/")),
    put: (rel: string, text = options.defaultText ?? ""): void => {
      const file = project.path(rel);
      if (options.parents !== false) mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    read: (rel: string): string => readFileSync(project.path(rel), "utf8"),
    state: (): Payload => JSON.parse(readFileSync(project.stateFile, "utf8")),
    audit: (): Payload[] =>
      readFileSync(project.auditFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    seed: (partial: Payload): void => {
      const { auto, ...rest } = partial;
      const now = project.state();
      writeFileSync(
        project.stateFile,
        JSON.stringify({ ...now, ...rest, ...(auto && { auto: { ...now.auto, ...auto } }) }),
      );
    },
    env: (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
      ...developerEnv(...(options.omitEnv ?? [])),
      ...callEnv(extra),
    }),
    fixture: (name: string, edit?: (p: Payload) => void): string =>
      claudeFixture(project.dir, name, (p) => {
        if (options.session !== undefined || options.taskSession) p.session_id = session;
        edit?.(p);
      }),
    write: (rel: string, agent?: string): string =>
      project.fixture(
        agent ? "pre-tool-use-write-from-plugin-agent" : "pre-tool-use-write",
        (p) => {
          p.tool_input.file_path = project.path(rel);
          if (agent) p.agent_type = agent;
        },
      ),
    readTool: (rel: string): string =>
      project.fixture("pre-tool-use-read", (p) => {
        p.tool_input.file_path = project.path(rel);
      }),
    hook: (
      input: string,
      extra: NodeJS.ProcessEnv = {},
      args: string[] = [],
    ): ReturnType<typeof runHook> =>
      (options.review && JSON.parse(input).hook_event_name === "SubagentStop"
        ? runReview
        : runHook)(
        input,
        {
          ...callEnv(),
          ...(typeof options.hookEnv === "function" ? options.hookEnv() : options.hookEnv),
          ...extra,
        },
        args,
      ),
    hookSync: (input: string, extra: NodeJS.ProcessEnv = {}, args: string[] = []): Run => {
      const result = spawnSync(process.execPath, [HOOK, ...args], {
        input,
        env: project.env(extra),
        encoding: "utf8",
      });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    hookAsync: (input: string): Promise<Run> =>
      new Promise((done) => {
        const child = spawn(process.execPath, [HOOK], { env: project.env() });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => {
          stdout += data;
        });
        child.stderr.on("data", (data) => {
          stderr += data;
        });
        child.on("close", (code) => done({ code, stdout, stderr }));
        child.stdin.end(input);
      }),
    reviewStop:
      (type: string) =>
      (report: string): ReturnType<typeof runHook> =>
        project.hook(
          project.fixture("subagent-stop-reviewer", (p) => {
            p.agent_type = type;
            p.last_assistant_message = report;
          }),
        ),
    coderStop: (active: boolean): ReturnType<typeof runHook> =>
      project.hook(
        project.fixture("subagent-stop-reviewer", (p) => {
          p.agent_type = "verid:coder";
          p.agent_id = "c1";
          p.stop_hook_active = active;
        }),
      ),
    stop: (active = false): ReturnType<typeof runHook> =>
      project.hook(
        project.fixture("stop", (p) => {
          p.stop_hook_active = active;
        }),
      ),
    actorWrite: async (agent: string, rel: string): Promise<ReturnType<typeof verdict>> =>
      verdict(
        await project.hook(
          project.fixture("pre-tool-use-write-from-plugin-agent", (p) => {
            p.agent_type = agent;
            p.tool_input.file_path = project.path(rel);
          }),
        ),
      ),
    gitRaw: (...args: string[]): GitResult => {
      const identity =
        options.gitIdentity === false
          ? []
          : [
              "-c",
              `user.name=${options.gitIdentity?.[0] ?? "t"}`,
              "-c",
              `user.email=${options.gitIdentity?.[1] ?? "t@t"}`,
            ];
      return spawnSync("git", [...identity, ...args], {
        cwd: project.dir,
        encoding: "utf8",
        ...(options.gitEnv && { env: options.gitEnv() }),
        ...(options.gitHide !== undefined && { windowsHide: options.gitHide }),
      });
    },
    gitChecked:
      (check: (result: GitResult) => void) =>
      (...args: string[]): void => {
        check(project.gitRaw(...args));
      },
    cliWith: async (extra: NodeJS.ProcessEnv, ...args: string[]): ReturnType<typeof runCli> => {
      const result = await runCli(args, project.dir, callEnv(extra));
      if (
        options.taskSession &&
        args[0] === "order" &&
        result.code === 0 &&
        project.state().kanban?.active?.session === null
      ) {
        if (Object.hasOwn(project.state().kanban.sessions, "claude-code:" + session))
          session = (options.session ?? FIXTURE_SESSION) + "-" + ++sessionCount;
        options.sessionChanged?.(session);
        await startTaskSession(project.dir, session);
      }
      return result;
    },
    cli: (...args: string[]): ReturnType<typeof runCli> => project.cliWith({}, ...args),
    reset: (): void => {
      if (options.state !== undefined || options.manifest !== undefined) {
        const target = resolve(project.dir, ".verid");
        if (!roots.some((temp) => target.startsWith(resolve(temp) + sep)))
          throw new Error("reset outside temporary project");
        rmSync(target, { recursive: true, force: true });
      }
      session = options.session ?? FIXTURE_SESSION;
      sessionCount = 0;
      options.sessionChanged?.(session);
      if (options.state !== undefined) {
        mkdirSync(dirname(project.stateFile), { recursive: true });
        writeFileSync(
          project.stateFile,
          typeof options.state === "string" ? options.state : JSON.stringify(options.state),
        );
      }
      if (options.manifest !== undefined) {
        mkdirSync(dirname(project.manifestFile), { recursive: true });
        writeFileSync(
          project.manifestFile,
          typeof options.manifest === "function" ? options.manifest() : options.manifest,
        );
      }
    },
    fresh: (): void => {
      root = mkdtempSync(join(tmpdir(), prefix));
      roots.push(root);
      dir = options.subdir ? join(root, options.subdir) : root;
      if (dir !== root) mkdirSync(dir, { recursive: true });
      options.bind?.(project);
      project.reset();
      if (options.approved) {
        for (const folder of [".verid/.state", "src", "test"])
          mkdirSync(project.path(folder), { recursive: true });
        project.put(
          ".verid/.state/state.json",
          JSON.stringify({
            schemaVersion: 1,
            tdd: { state: "PLATED", last_run: "seed", passed_acs: ["AC-1"] },
          }),
        );
        project.writeManifest();
        project.put(".verid/design.md", "# Design\nPure addition\n");
        project.put(".verid/research.md", "# Research\n");
        project.put(".verid/spec.md", "- REQ-1: adds two numbers\n");
        project.putPlan(
          ".verid/plan.md",
          "## Module: calc\n- AC-1: adds two numbers\n\n## Module: product\n- AC-9 (e2e): works end to end\n",
        );
        project.put(
          "scenario.json",
          JSON.stringify({ exit: 0, junit: "vitest-ac.xml", output: "passing evidence" }),
        );
      }
      options.setup?.(project);
    },
    newDir: (): string => {
      const created = mkdtempSync(join(tmpdir(), prefix));
      roots.push(created);
      return created;
    },
    hookArgs: (input: string, args: string[] = []): ReturnType<typeof runHook> =>
      project.hook(input, {}, args),

    putPlan: (rel: string, text = options.defaultText ?? ""): void => {
      if (rel === ".verid/plan.md") {
        if (options.planSpec && !existsSync(project.path(".verid/spec.md")))
          project.put(".verid/spec.md", options.planSpec);
        text = readyModulePlan(project.dir, text);
      }
      project.put(rel, text);
    },
    putAt: (dir: string, rel: string, text = options.defaultText ?? ""): void => {
      const file = join(dir, ...rel.split("/"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    putFile: (file: string, text: string): void => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        options.readyPlan && file.endsWith(join(".verid", "plan.md"))
          ? readyModulePlan(project.dir, text)
          : text,
      );
    },
    readAt: (dir: string, rel: string): string =>
      readFileSync(join(dir, ...rel.split("/")), "utf8"),
    readFile: (file: string): string => readFileSync(file, "utf8"),
    manifestText: (): string => readFileSync(project.manifestFile, "utf8"),
    editManifest: (edit: (value: Payload) => void): void => {
      const value = parseYaml(project.manifestText());
      edit(value);
      project.put(".verid/manifest.yaml", stringify(value));
    },
    objectManifest: (extra: Payload = {}): Payload =>
      projectManifest(extra, options.manifestPreset),
    writeManifest: (extra: Payload = {}): void =>
      project.put(".verid/manifest.yaml", JSON.stringify(project.objectManifest(extra))),
    manifestForDrive: (drive = "human"): Payload => project.objectManifest({ drive }),
    loadState: (): ReturnType<typeof readState> => readState(statePaths(project.dir)),
    auditText: (): string => readFileSync(project.auditFile, "utf8"),
    providerHook: (
      payload: unknown,
      provider = "codex",
      extra: NodeJS.ProcessEnv = {},
    ): ReturnType<typeof runHook> =>
      project.hook(typeof payload === "string" ? payload : JSON.stringify(payload), extra, [
        "--provider",
        provider,
      ]),
    inputHook: (
      payload: Payload,
      attended = false,
      configDir?: string,
    ): ReturnType<typeof runHook> =>
      project.hook(
        JSON.stringify({
          session_id: options.sessionId?.() ?? project.session,
          cwd: project.dir,
          ...payload,
        }),
        {
          ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
          ...(attended ? { CLAUDE_CODE_SESSION_ATTENDED: "1" } : {}),
        },
      ),
    guardHook: async (
      payload: Payload,
      attended = false,
      configDir?: string,
    ): Promise<{ code: number; stderr: string }> => {
      const result = await project.inputHook(payload, attended, configDir);
      return { code: result.code, stderr: result.stderr };
    },
    event: (event: string, extra: Payload = {}): ReturnType<typeof runHook> =>
      project.hook(
        JSON.stringify({
          hook_event_name: event,
          session_id: options.sessionId?.() ?? project.session,
          cwd: project.dir,
          ...options.payload,
          ...extra,
        }),
        {},
        options.provider && options.provider !== "claude-code"
          ? ["--provider", options.provider]
          : [],
      ),
    sessionEvent: (
      event: string,
      session: string,
      extra: Payload = {},
      provider = options.provider ?? "codex",
    ): ReturnType<typeof runHook> =>
      project.hook(
        JSON.stringify({
          hook_event_name: event,
          cwd: project.dir,
          session_id: session,
          ...options.payload,
          ...extra,
        }),
        {},
        provider === "codex" ? ["--provider", "codex"] : [],
      ),
    writeCall: (path: string): ReturnType<typeof runHook> =>
      project.event("PreToolUse", {
        agent_id: "coder-1",
        agent_type: "verid:coder",
        tool_name: "Write",
        tool_input: { file_path: project.path(path), content: "x" },
      }),
    pathHook: async (
      path: string,
      writer?: string,
      tool = "Write",
      input?: object,
    ): Promise<{ code: number; err: string }> => {
      const result = await project.event("PreToolUse", {
        tool_name: tool,
        tool_input: input ?? { file_path: path, content: "test" },
        ...(writer && { agent_id: "worker", agent_type: `verid:${writer}` }),
      });
      return { code: result.code, err: result.stderr };
    },
    gitRawAt: (cwd: string, ...args: string[]): GitResult => {
      const identity =
        options.gitIdentity === false
          ? []
          : [
              "-c",
              `user.name=${options.gitIdentity?.[0] ?? "t"}`,
              "-c",
              `user.email=${options.gitIdentity?.[1] ?? "t@t"}`,
            ];
      return spawnSync("git", [...identity, ...args], {
        cwd,
        encoding: "utf8",
        ...(options.gitEnv && { env: options.gitEnv() }),
        ...(options.gitHide !== undefined && { windowsHide: options.gitHide }),
      });
    },
    gitAt: (cwd: string, ...args: string[]): string => {
      const result = project.gitRawAt(cwd, ...args);
      if (result.status !== 0)
        throw new Error(`${options.gitPrefix ?? "git "}${args.join(" ")}: ${result.stderr}`);
      return result.stdout.trim();
    },
    cliAt: (
      args: string[],
      cwd: string = project.dir,
      extra: NodeJS.ProcessEnv = {},
    ): ReturnType<typeof runCli> =>
      runCli(args, cwd, {
        ...callEnv(),
        ...(typeof options.cliEnv === "function" ? options.cliEnv() : options.cliEnv),
        ...extra,
      }),
    cliBound: (...args: string[]): ReturnType<typeof runCli> => project.cliAt(args),
    shortCliAt: async (
      args: string[],
      cwd: string = project.dir,
      extra: NodeJS.ProcessEnv = {},
    ): Promise<{ code: number; out: string; err: string }> => {
      const result = await project.cliAt(args, cwd, extra);
      return { code: result.code, out: result.stdout, err: result.stderr };
    },
    shortCliArgs: (
      args: string[],
      extra: NodeJS.ProcessEnv = {},
    ): Promise<{ code: number; out: string; err: string }> =>
      project.shortCliAt(args, project.dir, extra),
    rawCliFile: (entry: string, ...args: string[]): SpawnSyncReturns<string> =>
      spawnSync(process.execPath, [entry, ...args], {
        cwd: project.dir,
        env: project.env(),
        encoding: "utf8",
      }),
    rawCli: (args: string[]): SpawnSyncReturns<string> => project.rawCliFile(CLI, ...args),
    rawCliArgs: (...args: string[]): SpawnSyncReturns<string> => project.rawCli(args),
    spawnCliAt: (cwd: string, ...args: string[]): Run => {
      const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd,
        env: project.env(),
        encoding: "utf8",
      });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    spawnCook: (cwd: string, ...args: string[]): Run => project.spawnCliAt(cwd, "cook", ...args),
    spawnCookWith: (env: NodeJS.ProcessEnv, cwd: string, ...args: string[]): Run => {
      const result = spawnSync(process.execPath, [CLI, "cook", ...args], {
        cwd,
        env,
        encoding: "utf8",
      });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    shortSpawnArgs: (
      args: string[],
      extra: NodeJS.ProcessEnv = {},
    ): { code: number | null; out: string; err: string } => {
      const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: project.dir,
        env: project.env(extra),
        encoding: "utf8",
      });
      return { code: result.status, out: result.stdout, err: result.stderr };
    },
    settingsHook: (cwd: string, event: string, input: string): Run => {
      const groups = JSON.parse(readFileSync(join(cwd, ".claude/settings.local.json"), "utf8"))
        .hooks[event] as Payload[];
      const handler = groups.at(-1)?.hooks.at(-1);
      const result = spawnSync(handler.command, handler.args, {
        cwd,
        input,
        env: project.env({ CLAUDE_PROJECT_DIR: cwd }),
        encoding: "utf8",
      });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },
  };
  beforeEach(project.fresh);
  afterEach(async () => {
    try {
      await options.teardown?.();
    } finally {
      for (const created of roots.splice(0).reverse()) {
        const target = resolve(created);
        if (dirname(target) !== resolve(tmpdir()))
          throw new Error("cleanup outside temporary directory");
        rmSync(target, { recursive: true, force: true, ...options.cleanup });
      }
    }
  });
  return project;
}

export function projectManifest(extra: Payload = {}, preset = "plain"): Payload {
  const repo: Payload = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };
  if (preset === "review" || preset === "antigravity")
    repo.test_cmd = `"${process.execPath}" "${RUNNER}" {junit}`;
  const value: Payload = {
    schemaVersion: 1,
    mode: preset === "review" || preset === "antigravity" ? "recipe" : "remix",
  };
  if (preset === "review") value.drive = "human";
  if (preset === "codex")
    Object.assign(value, {
      providers: ["codex"],
      roles: {
        reviewer: ["reviewer", "verid_reviewer"],
        tester: ["verid:tester"],
        coder: ["verid:coder"],
      },
    });
  if (preset === "review")
    Object.assign(value, {
      providers: ["claude-code", "codex"],
      roles: {
        reviewer: ["verid:reviewer", "verid_reviewer"],
        security: ["verid:security", "codex_security"],
      },
    });
  if (preset === "antigravity")
    Object.assign(value, {
      providers: ["antigravity"],
      roles: { reviewer: ["verid-reviewer"], tester: ["verid:tester"], coder: ["verid:coder"] },
    });
  return { ...value, repos: [repo], ...extra };
}

export const readJUnitFixture = (name: string): ReturnType<typeof readJUnit> =>
  readJUnit(join(TEST_ROOT, "test/fixtures/junit", name));
export const kanbanManifest = (): string =>
  stringify({
    schemaVersion: 1,
    workflow: "kanban",
    mode: "prep",
    providers: ["codex"],
    roles: defaultRoles(["codex"]),
    architecture: "none",
    repos: [
      {
        path: ".",
        source_globs: ["src/**"],
        test_globs: ["test/**"],
        test_cmd: `"${process.execPath}" "${RUNNER}" {junit}`,
      },
    ],
  });
