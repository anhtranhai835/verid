import { spawn, type ChildProcess } from "node:child_process";
import { ownEntry } from "../core/station.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Provider } from "../core/manifest.js";
import { loadManifest } from "./manifest.js";
import { languageOf, readState, statePaths, withLock } from "./state-store.js";
import { systemLanguage, t, type Lang } from "./i18n.js";
import { appendAudit } from "./audit-log.js";
import { isCount, type TokenUsage } from "../core/usage.js";
import { scheduleStations } from "./station.js";
import { autoPhase } from "../core/auto.js";
import { autoFactsOf } from "./plan-file.js";

/**
 * The board's chat: it runs the provider's own CLI headless in the project, one run at a time.
 * In no-brain drive it is the drive's one session: the first message starts it and later messages
 * resume it while the board runs. With a selected task (big-brain), the first message starts a
 * session that verid's SessionStart hook binds to the task; later messages resume that session. Every tool call still passes
 * verid's hook, and permissions stay narrow: edits are accepted, shell is sandboxed or limited to
 * verid and read-only git.
 */
export interface ChatLine {
  role: "you" | "ai" | "tool" | "error" | "info";
  text: string;
}

export interface Launch {
  command: string;
  args: string[];
  /** Sent on stdin, so the developer's text never reaches a command line. */
  stdin: string | null;
}

const MAX_LINES = 500;
const MAX_TEXT = 4_000;
const MAX_PROMPT = 24_000;
const MAX_RUN_MS = 60 * 60 * 1000;
const SAFE_ID = /^[\w.:-]{1,200}$/;

/** Shell commands a headless Claude Code session may run without asking: verid and local git. */
export const CLAUDE_ALLOW = [
  "Bash(node .verid/verid.mjs:*)",
  "Bash(verid:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
];

function claudeSettingsFile(project: string): string {
  const file = join(project, ".verid", ".state", "board-claude-settings.json");
  mkdirSync(join(project, ".verid", ".state"), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ permissions: { defaultMode: "acceptEdits", allow: CLAUDE_ALLOW } }, null, 2)}\n`,
  );
  return file;
}

/** The headless command for one message; `resume` is the provider's own session ID. */
export function launchFor(
  provider: Provider,
  prompt: string,
  resume: string | null,
  project: string,
): Launch {
  if (resume !== null && !SAFE_ID.test(resume))
    throw new Error(t(languageOf(project) ?? systemLanguage(), "board.err_session_id", {}));
  if (provider === "claude-code")
    return {
      command: "claude",
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--settings",
        claudeSettingsFile(project),
        ...(resume ? ["--resume", resume] : []),
      ],
      stdin: prompt,
    };
  const options = ["--json", "-c", "sandbox_mode=workspace-write", "-c", "approval_policy=never"];
  return {
    command: "codex",
    args: resume
      ? ["exec", "resume", ...options, resume, "-"]
      : ["exec", ...options, "--skip-git-repo-check", "-"],
    stdin: prompt,
  };
}

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
const obj = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** One stdout line of a provider's JSON stream: the session ID it names and what to show. */
export function readEvent(line: string): {
  id?: string;
  lines: ChatLine[];
  usage?: TokenUsage & { provider: "claude-code" | "codex" };
} {
  const trimmed = line.trim();
  if (!trimmed) return { lines: [] };
  let event: Record<string, unknown> | undefined;
  try {
    event = obj(JSON.parse(trimmed));
  } catch {
    return { lines: [{ role: "ai", text: clip(trimmed) }] };
  }
  if (!event) return { lines: [] };
  const id =
    str(event.session_id) ??
    str(event.thread_id) ??
    str(event.conversationId) ??
    str(event.conversation_id);
  const out: ChatLine[] = [];
  const type = str(event.type) ?? "";
  // Claude Code
  if (type === "assistant") {
    const content = obj(event.message)?.content;
    for (const part of Array.isArray(content) ? content : []) {
      const p = obj(part);
      if (p?.type === "text" && str(p.text)) out.push({ role: "ai", text: clip(String(p.text)) });
      if (p?.type === "tool_use") out.push({ role: "tool", text: toolLine(p.name, p.input) });
    }
  } else if (type === "result") {
    if (event.is_error === true || (str(event.subtype) ?? "success") !== "success")
      out.push({ role: "error", text: clip(str(event.result) ?? str(event.subtype) ?? "error") });
    // Codex
  } else if (type === "item.completed") {
    const item = obj(event.item) ?? {};
    if (item.type === "agent_message" && str(item.text))
      out.push({ role: "ai", text: clip(String(item.text)) });
    else if (item.type === "command_execution")
      out.push({
        role: "tool",
        text: `$ ${str(item.command) ?? ""}${typeof item.exit_code === "number" ? `  → ${item.exit_code}` : ""}`,
      });
    else if (item.type === "file_change" && Array.isArray(item.changes))
      out.push({
        role: "tool",
        text: item.changes
          .map((c) => `${str(obj(c)?.kind) ?? "edit"} ${str(obj(c)?.path) ?? ""}`)
          .join("\n"),
      });
    else if (item.type === "error" && str(item.message))
      out.push({ role: "error", text: clip(String(item.message)) });
  } else if (type === "turn.failed" || type === "error") {
    const message = str(obj(event.error)?.message) ?? str(event.message);
    if (message) out.push({ role: "error", text: clip(message) });
  } else if (
    !["system", "user", "thread.started", "turn.started", "turn.completed"].includes(type)
  ) {
    // A shape not known yet: show the text it carries, if any.
    const message = obj(event.message);
    const text =
      str(event.text) ?? str(event.content) ?? str(message?.text) ?? str(message?.content);
    if (text) out.push({ role: /error/i.test(type) ? "error" : "ai", text: clip(text) });
  }
  const usage = readUsage(type, obj(event.usage));
  return { ...(id ? { id } : {}), lines: out, ...(usage ? { usage } : {}) };
}

function readUsage(type: string, usage: Record<string, unknown> | undefined) {
  if (!usage || !isCount(usage.input_tokens) || !isCount(usage.output_tokens)) return;
  if (
    type === "result" &&
    isCount(usage.cache_creation_input_tokens) &&
    isCount(usage.cache_read_input_tokens)
  ) {
    const input =
      usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
    if (isCount(input))
      return {
        provider: "claude-code" as const,
        input,
        cached: usage.cache_read_input_tokens,
        output: usage.output_tokens,
      };
  }
  if (
    type === "turn.completed" &&
    isCount(usage.cached_input_tokens) &&
    usage.cached_input_tokens <= usage.input_tokens
  )
    return {
      provider: "codex" as const,
      input: usage.input_tokens,
      cached: usage.cached_input_tokens,
      output: usage.output_tokens,
    };
}

function toolLine(name: unknown, input: unknown): string {
  const args = obj(input) ?? {};
  const detail = str(args.command) ?? str(args.file_path) ?? str(args.pattern) ?? str(args.path);
  return `${str(name) ?? "tool"}${detail ? `: ${clip(detail)}` : ""}`;
}

/** Windows runs npm's .cmd shims through cmd.exe: quote each argument, refuse cmd metacharacters. */
export function windowsArgs(args: readonly string[], lang: Lang = systemLanguage()): string[] {
  return args.map((arg) => {
    if (/["%^&|<>!\r\n]/.test(arg)) throw new Error(t(lang, "board.err_chat_arg", { arg }));
    return /^[\w.:\\/=@,-]+$/.test(arg) ? arg : `"${arg}"`;
  });
}

export type Spawner = (launch: Launch, cwd: string) => ChildProcess;

const spawnLaunch: Spawner = (launch, cwd) => {
  const win = process.platform === "win32";
  // claude and codex are .cmd shims on Windows, which need cmd.exe.
  const shell = win;
  return spawn(
    launch.command,
    shell ? windowsArgs(launch.args, languageOf(cwd) ?? systemLanguage()) : launch.args,
    {
      cwd,
      shell,
      windowsHide: true,
      stdio: [launch.stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
    },
  );
};

export interface ChatStatus {
  task: string | null;
  provider: Provider | null;
  providers: Provider[];
  /** Set once a session is bound to the task: later messages must use that provider. */
  locked: Provider | null;
  running: boolean;
  lines: ChatLine[];
}

export function boardChat(
  project: string,
  spawner: Spawner = spawnLaunch,
  onIdle: () => void = () => {},
) {
  const say = (key: string, params: Record<string, string> = {}) =>
    t(languageOf(project) ?? systemLanguage(), `board.${key}`, params);
  let child: ChildProcess | null = null;
  let task: string | null = null;
  let provider: Provider | null = null;
  let captured: string | null = null;
  let lines: ChatLine[] = [];
  const add = (line: ChatLine) => {
    lines.push(line);
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  };

  /** The bound session of the selected task, as provider and provider-side ID. */
  const bound = (): { provider: Provider; id: string } | null => {
    const session = readState(statePaths(project)).kanban.active?.session ?? null;
    const match = session === null ? null : /^(claude-code|codex):(.+)$/.exec(session);
    return match ? { provider: match[1] as Provider, id: match[2]! } : null;
  };

  async function status(): Promise<ChatStatus> {
    const manifest = await loadManifest(project, { readOnly: true });
    const queue = manifest?.drive === "auto";
    const active = readState(statePaths(project)).kanban.active;
    if (!queue && active?.module !== task && child === null) {
      // Another task, or none: its conversation is not this one's.
      task = active?.module ?? null;
      lines = [];
      captured = null;
    }
    return {
      task,
      provider,
      providers: manifest?.providers ?? [],
      locked: bound()?.provider ?? (queue && captured ? provider : null),
      running: child !== null,
      lines,
    };
  }

  /** `task` is null for no-brain drive's queue session; usage then goes to the module it works on. */
  async function send(input: {
    task: string | null;
    text: string;
    provider: string;
  }): Promise<void> {
    if (child) throw new Error(say("chat_busy"));
    const state = readState(statePaths(project));
    if (state.halted) throw new Error(say("halted", { reason: state.halted.reason }));
    if (input.task !== null && state.kanban.active?.module !== input.task)
      throw new Error(say("err_chat_select"));
    const text = input.text.trim();
    if (!text) throw new Error(say("chat_type_first"));
    if (text.length > MAX_PROMPT) throw new Error(say("chat_too_long"));
    const manifest = await loadManifest(project, { readOnly: true });
    const session = bound();
    const chosen = (session?.provider ?? input.provider) as Provider;
    if (!manifest?.providers.includes(chosen))
      throw new Error(say("chat_provider_off", { provider: chosen }));
    const resume = session?.id ?? (provider === chosen && task === input.task ? captured : null);
    const launch = launchFor(chosen, text, resume, project);
    if (task !== input.task) lines = [];
    task = input.task;
    provider = chosen;
    add({ role: "you", text: clip(text) });
    if (!resume)
      add({
        role: "info",
        text: task
          ? say("chat_new_task_session", { provider: chosen, task })
          : say("chat_new_session", { provider: chosen }),
      });

    const run = spawner(launch, project);
    child = run;
    const errors: string[] = [];
    let buffer = "";
    const accept = (part: string) => {
      const event = readEvent(part);
      if (event.id) captured = event.id;
      event.lines.forEach(add);
      if (event.usage?.provider === chosen) {
        try {
          const paths = statePaths(project);
          withLock(paths, () =>
            appendAudit(paths.audit, {
              event: "usage_recorded",
              module:
                input.task ??
                readState(paths).station?.module ??
                readState(paths).auto.work?.module ??
                "",
              ...event.usage!,
            }),
          );
        } catch {
          add({ role: "error", text: say("chat_usage_failed") });
        }
      }
    };
    run.stdout?.setEncoding("utf8");
    run.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) accept(part);
    });
    run.stderr?.setEncoding("utf8");
    run.stderr?.on("data", (chunk: string) => {
      errors.push(...chunk.split(/\r?\n/).filter(Boolean));
      if (errors.length > 20) errors.splice(0, errors.length - 20);
    });
    const timer = setTimeout(() => stop(), MAX_RUN_MS);
    run.on("error", (error) => {
      add({
        role: "error",
        text: say("chat_launch_failed", { command: launch.command, error: error.message }),
      });
    });
    run.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) accept(buffer);
      if (code !== 0) {
        if (errors.length) add({ role: "error", text: clip(errors.join("\n")) });
        add({
          role: "error",
          text: say("chat_exit", { command: launch.command, code: String(code ?? "?") }),
        });
      } else add({ role: "info", text: say("chat_done") });
      if (child === run) child = null;
      onIdle();
    });
    if (launch.stdin !== null) run.stdin?.end(launch.stdin);
  }

  function stop(): void {
    const run = child;
    if (!run?.pid) return;
    add({ role: "info", text: say("chat_stopped") });
    if (process.platform === "win32")
      spawn("taskkill", ["/pid", String(run.pid), "/T", "/F"], { windowsHide: true });
    else run.kill("SIGTERM");
  }

  return {
    status,
    send,
    stop,
    running: () => child !== null,
    note: (text: string) => add({ role: "error", text }),
  };
}

/** What a station's own session is told to do: its one module, inside its Boundary. */
export const stationBrief = (module: string) =>
  `Run verid context ${module}. Complete only this module using verid menu, TDD, taste and independent review. Stay inside Boundary. Stop after it is served; integration belongs to the developer.`;

/** A bounded process pool; each worktree keeps its own provider ID, transcript and stop button. */
export function stationBoardChat(project: string, spawner: Spawner = spawnLaunch) {
  type Chat = ReturnType<typeof boardChat>;
  const chats = new Map<string, { root: string; generation: string; chat: Chat }>();
  const started = new Set<string>();
  let selectedProvider: string | null = null;
  let pumping = false;
  let stopped = false;
  const launching = new Set<string>();
  const say = (key: string, params: Record<string, string> = {}) =>
    t(languageOf(project) ?? systemLanguage(), `board.${key}`, params);
  const keyOf = (name: string | null) => name ?? "";
  const get = (name: string | null, forLaunch = false): Chat => {
    const record = name === null ? null : ownEntry(readState(statePaths(project)).stations, name);
    if (name !== null && (!record || (forLaunch && record.stage !== "open")))
      throw new Error(say("err_station_open"));
    const root = record?.path ?? project;
    const key = keyOf(name);
    const existing = chats.get(key);
    const generation = record?.at ?? "";
    if (existing && (existing.root !== root || existing.generation !== generation)) {
      existing.chat.stop();
      chats.delete(key);
      started.delete(key);
    }
    if (!chats.has(key))
      chats.set(key, {
        root,
        generation,
        chat: boardChat(root, spawner, () => {
          void pump().catch((error: unknown) => {
            const coordinator = chats.get("");
            coordinator?.chat.note(
              say("station_launch_failed", {
                detail: error instanceof Error ? error.message : String(error),
              }),
            );
          });
        }),
      });
    return chats.get(key)!.chat;
  };
  const running = () => [...chats.values()].filter(({ chat }) => chat.running()).length;
  async function send(
    name: string | null,
    input: { task: string | null; text: string; provider: string },
  ) {
    const manifest = await loadManifest(project, { readOnly: true });
    const chat = get(name, true);
    const key = keyOf(name);
    if (launching.has(key) || running() + launching.size >= (manifest?.stations ?? 1))
      throw new Error(say("err_station_limit"));
    launching.add(key);
    selectedProvider = input.provider;
    stopped = false;
    try {
      await chat.send(input);
      if (name) started.add(name);
    } finally {
      launching.delete(key);
    }
  }
  async function pump() {
    if (pumping || stopped || !selectedProvider) return;
    pumping = true;
    try {
      const manifest = await loadManifest(project, { readOnly: true });
      if (manifest?.drive !== "auto" || (manifest.stations ?? 1) === 1) return;
      scheduleStations(project, manifest);
      const state = readState(statePaths(project));
      if (state.halted) return;
      for (const record of Object.values(state.stations)) {
        if (running() + launching.size >= (manifest.stations ?? 1)) break;
        if (record.stage !== "open" || started.has(record.module)) continue;
        const local = readState(statePaths(record.path));
        const phase = autoPhase(
          autoFactsOf(
            record.path,
            local,
            manifest.iterations !== undefined,
            true,
            manifest.stations ?? 1,
          ),
        );
        if (phase.kind === "stuck" || phase.kind === "done") continue;
        await send(record.module, {
          task: null,
          provider: selectedProvider,
          text: stationBrief(record.module),
        });
      }
    } finally {
      pumping = false;
    }
  }
  function stop(name: string | null) {
    if (name === null) stopped = true;
    (chats.get(keyOf(name))?.chat ?? get(name)).stop();
  }
  function stopAll() {
    stopped = true;
    for (const { chat } of chats.values()) chat.stop();
  }
  return { status: (name: string | null) => get(name).status(), send, stop, stopAll };
}
