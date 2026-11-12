import type { SpawnSyncReturns } from "node:child_process";
import type { readState } from "../../src/adapters/state-store.js";
import type { runCli, runHook } from "../e2e/in-process.js";
import type { verdict, Payload } from "./fixtures.js";
export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type GitResult = SpawnSyncReturns<string>;

export interface ProjectFiles {
  readonly root: string;
  readonly dir: string;
  readonly stateFile: string;
  readonly auditFile: string;
  readonly manifestFile: string;
  readonly lockFile: string;
  path(rel: string): string;
}

export interface ProjectOptions {
  subdir?: string;
  cwd?: () => string;
  state?: string | object;
  manifest?: string | (() => string);
  bind?: (project: ProjectFiles) => void;
  setup?: (project: TestProject) => void;
  teardown?: () => void | Promise<void>;
  env?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
  omitEnv?: string[];
  claudeProject?: boolean;
  review?: boolean;
  session?: string;
  taskSession?: boolean;
  sessionChanged?: (session: string) => void;
  cleanup?: { maxRetries?: number; retryDelay?: number };
  canonical?: boolean;
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
  manifestPreset?: "plain" | "codex" | "review";
  hookEnv?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
  approved?: boolean;
}

export interface TestProject extends ProjectFiles {
  installedHook: (event: string, extra?: Payload) => SpawnSyncReturns<string>;
  gitManifest: (extra?: string, repos?: string) => void;
  contextSetup: (language?: string, extra?: Payload) => void;
  startSession: (source: string, provider?: string) => ReturnType<typeof runHook>;
  payloadFor: (event: string, session: string, extra?: Payload) => string;
  newDir: (prefix?: string) => string;
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
