import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterEach, beforeEach } from "vitest";
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
  const project = {
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
    put: (rel: string, text: string): void => {
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
    hook: (input: string, extra: NodeJS.ProcessEnv = {}, args: string[] = []): Promise<Run> =>
      (options.review && JSON.parse(input).hook_event_name === "SubagentStop"
        ? runReview
        : runHook)(input, callEnv(extra), args),
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
      (report: string): Promise<Run> =>
        project.hook(
          project.fixture("subagent-stop-reviewer", (p) => {
            p.agent_type = type;
            p.last_assistant_message = report;
          }),
        ),
    coderStop: (active: boolean): Promise<Run> =>
      project.hook(
        project.fixture("subagent-stop-reviewer", (p) => {
          p.agent_type = "verid:coder";
          p.agent_id = "c1";
          p.stop_hook_active = active;
        }),
      ),
    stop: (active = false): Promise<Run> =>
      project.hook(
        project.fixture("stop", (p) => {
          p.stop_hook_active = active;
        }),
      ),
    actorWrite: async (agent: string, rel: string) =>
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
    cliWith: async (extra: NodeJS.ProcessEnv, ...args: string[]): Promise<Run> => {
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
    cli: (...args: string[]): Promise<Run> => project.cliWith({}, ...args),
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
      options.setup?.(project);
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
