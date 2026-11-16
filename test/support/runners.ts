import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, runHook, runReview } from "../e2e/in-process.js";
import { CLI, HOOK, developerEnv, claudeFixture, verdict, type Payload } from "./fixtures.js";
import type { Run, GitResult, TestProject, ProjectOptions } from "./types.js";
export function createRunners(
  project: TestProject,
  options: ProjectOptions,
  onOrder: () => Promise<void>,
): Pick<
  TestProject,
  | "installedHook"
  | "env"
  | "fixture"
  | "write"
  | "readTool"
  | "hook"
  | "hookSync"
  | "hookAsync"
  | "reviewStop"
  | "coderStop"
  | "stop"
  | "actorWrite"
  | "gitRaw"
  | "gitChecked"
  | "cliWith"
  | "cli"
  | "hookArgs"
  | "providerHook"
  | "inputHook"
  | "guardHook"
  | "event"
  | "sessionEvent"
  | "writeCall"
  | "pathHook"
  | "gitRawAt"
  | "gitAt"
  | "cliAt"
  | "cliBound"
  | "shortCliAt"
  | "shortCliArgs"
  | "rawCliFile"
  | "rawCli"
  | "rawCliArgs"
  | "spawnCliAt"
  | "spawnCook"
  | "spawnCookWith"
  | "shortSpawnArgs"
  | "settingsHook"
  | "startSession"
  | "payloadFor"
> {
  const callEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...(options.claudeProject === false ? {} : { CLAUDE_PROJECT_DIR: project.dir }),
    ...(typeof options.env === "function" ? options.env() : options.env),
    ...extra,
  });
  return {
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
    env: (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
      ...developerEnv(...(options.omitEnv ?? [])),
      ...callEnv(extra),
    }),
    fixture: (name: string, edit?: (p: Payload) => void): string =>
      claudeFixture(project.dir, name, (p) => {
        if (options.session !== undefined || options.taskSession) p.session_id = project.session;
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
        await onOrder();
      }
      return result;
    },
    cli: (...args: string[]): ReturnType<typeof runCli> => project.cliWith({}, ...args),
    hookArgs: (input: string, args: string[] = []): ReturnType<typeof runHook> =>
      project.hook(input, {}, args),
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
}
