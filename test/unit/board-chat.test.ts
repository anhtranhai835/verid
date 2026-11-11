import { tempDirs, tempProject, kanbanManifest } from "../support/project.js";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { verifyAuditChain } from "../../src/adapters/audit-log.js";
const project = tempDirs("verid-chat-", "suite")();
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  boardChat,
  CLAUDE_ALLOW,
  launchFor,
  readEvent,
  windowsArgs,
} from "../../src/adapters/board-chat.js";

describe("board usage recording", () => {
  const p = tempProject("verid-chat-usage-", {
    manifest: kanbanManifest,
    state: {
      schemaVersion: 1,
      kanban: { active: { module: "api", session: null, spec_sha256: "hash" }, sessions: {} },
    },
  });

  it("records fragmented and unterminated usage lines once for the selected task", async () => {
    const run = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    });
    const chat = boardChat(p.root, () => run as unknown as ChildProcess);
    await chat.send({ task: "api", text: "PRIVATE_PROMPT", provider: "codex" });
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 20, cached_input_tokens: 4, output_tokens: 5 },
      result: "PRIVATE_OUTPUT",
    });
    run.stdout.write(line.slice(0, 20));
    run.stdout.write(line.slice(20) + "\n" + line);
    run.emit("close", 0);
    expect(p.audit().filter((e) => e.event === "usage_recorded")).toEqual([
      expect.objectContaining({
        module: "api",
        provider: "codex",
        input: 20,
        cached: 4,
        output: 5,
      }),
      expect.objectContaining({
        module: "api",
        provider: "codex",
        input: 20,
        cached: 4,
        output: 5,
      }),
    ]);
    expect(p.read(".verid/.state/audit.jsonl")).not.toMatch(/PRIVATE_PROMPT|PRIVATE_OUTPUT|result/);
    expect(verifyAuditChain(p.auditFile)).toEqual({ ok: true, count: 2 });
  });

  it("does not record absent usage or usage from a different provider", async () => {
    const run = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    });
    const chat = boardChat(p.root, () => run as unknown as ChildProcess);
    await chat.send({ task: "api", text: "hello", provider: "codex" });
    run.stdout.write(
      JSON.stringify({
        type: "result",
        usage: {
          input_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 1,
        },
      }) + "\n",
    );
    run.stdout.write('{"type":"turn.completed"}');
    run.emit("close", 0);
    expect(() => p.read(".verid/.state/audit.jsonl")).toThrow();
  });
});

describe("board chat launches", () => {
  it("sends Claude Code's prompt on stdin with narrow settings and resumes by session ID", () => {
    const fresh = launchFor("claude-code", "do AC-1", null, project);
    expect(fresh.command).toBe("claude");
    expect(fresh.stdin).toBe("do AC-1");
    expect(fresh.args.join(" ")).not.toContain("do AC-1");
    expect(fresh.args).not.toContain("--resume");
    const settings = JSON.parse(
      readFileSync(fresh.args[fresh.args.indexOf("--settings") + 1]!, "utf8"),
    );
    expect(settings.permissions).toEqual({ defaultMode: "acceptEdits", allow: CLAUDE_ALLOW });
    expect(CLAUDE_ALLOW.some((rule) => /push|rm |Bash\(\*\)/.test(rule))).toBe(false);
    const next = launchFor("claude-code", "go on", "6f1c-aa", project);
    expect(next.args.slice(-2)).toEqual(["--resume", "6f1c-aa"]);
  });

  it("runs Codex in the workspace-write sandbox and resumes the bound thread", () => {
    const fresh = launchFor("codex", "x", null, project);
    expect(fresh.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(fresh.args).toContain("sandbox_mode=workspace-write");
    expect(fresh.args.at(-1)).toBe("-");
    const next = launchFor("codex", "x", "thread-1", project);
    expect(next.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(next.args.slice(-2)).toEqual(["thread-1", "-"]);
  });

  it("passes Antigravity's prompt as the last argv entry, sandboxed with accept-edits", () => {
    const launch = launchFor("antigravity", "hello & bye", "conv-9", project);
    expect(launch.stdin).toBeNull();
    expect(launch.args.slice(-2)).toEqual(["-p", "hello & bye"]);
    expect(launch.args).toEqual(expect.arrayContaining(["--sandbox", "accept-edits", "conv-9"]));
  });

  it("refuses unsafe session IDs and cmd.exe metacharacters", () => {
    expect(() => launchFor("codex", "x", "a b; rm", project)).toThrow();
    expect(windowsArgs(["-p", "C:\\a b\\s.json", "sandbox_mode=workspace-write"])).toEqual([
      "-p",
      '"C:\\a b\\s.json"',
      "sandbox_mode=workspace-write",
    ]);
    for (const bad of ['a"b', "a&b", "%PATH%", "a|b"]) expect(() => windowsArgs([bad])).toThrow();
  });
});

describe("board chat events", () => {
  it("reads sanitized Claude result usage including cache creation and cache reads", () => {
    // Claude Code 2.1.319 emitted these four counters; nonzero values exercise normalization.
    const event = {
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 12,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 80,
        output_tokens: 9,
      },
    };
    expect(readEvent(JSON.stringify(event)).usage).toEqual({
      provider: "claude-code",
      input: 122,
      cached: 80,
      output: 9,
    });
  });

  it("reads documented Codex turn usage without adding cached input twice", () => {
    const event = {
      type: "turn.completed",
      usage: {
        input_tokens: 24763,
        cached_input_tokens: 24448,
        output_tokens: 122,
      },
    };
    expect(readEvent(JSON.stringify(event)).usage).toEqual({
      provider: "codex",
      input: 24763,
      cached: 24448,
      output: 122,
    });
  });

  it.each([
    { type: "result" },
    { type: "turn.completed", usage: { input_tokens: 3, output_tokens: 1 } },
    {
      type: "turn.completed",
      usage: { input_tokens: -1, cached_input_tokens: 0, output_tokens: 1 },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: 1, cached_input_tokens: 2, output_tokens: 1 },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: "3", cached_input_tokens: 0, output_tokens: 1 },
    },
    { type: "assistant", usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 1 } },
  ])("ignores absent, partial, invalid or nonterminal usage %#", (event) => {
    expect(readEvent(JSON.stringify(event))).not.toHaveProperty("usage");
  });

  it("reads Claude Code's stream-json", () => {
    expect(readEvent('{"type":"system","subtype":"init","session_id":"s1"}')).toEqual({
      id: "s1",
      lines: [],
    });
    const turn = readEvent(
      JSON.stringify({
        type: "assistant",
        session_id: "s1",
        message: {
          content: [
            { type: "text", text: "Writing the test" },
            { type: "tool_use", name: "Bash", input: { command: "node .verid/verid.mjs taste" } },
          ],
        },
      }),
    );
    expect(turn.lines).toEqual([
      { role: "ai", text: "Writing the test" },
      { role: "tool", text: "Bash: node .verid/verid.mjs taste" },
    ]);
    expect(readEvent('{"type":"result","subtype":"success","result":"done"}').lines).toEqual([]);
    expect(readEvent('{"type":"result","is_error":true,"result":"denied"}').lines).toEqual([
      { role: "error", text: "denied" },
    ]);
  });

  it("reads Codex's JSONL", () => {
    expect(readEvent('{"type":"thread.started","thread_id":"t1"}').id).toBe("t1");
    expect(
      readEvent('{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}').lines,
    ).toEqual([{ role: "ai", text: "ok" }]);
    expect(
      readEvent(
        '{"type":"item.completed","item":{"type":"command_execution","command":"npm test","exit_code":1}}',
      ).lines,
    ).toEqual([{ role: "tool", text: "$ npm test  → 1" }]);
    expect(readEvent('{"type":"turn.failed","error":{"message":"boom"}}').lines).toEqual([
      { role: "error", text: "boom" },
    ]);
  });

  it("shows text from unknown shapes and plain lines, and ignores noise", () => {
    expect(readEvent('{"type":"message","conversationId":"c1","text":"hi"}')).toEqual({
      id: "c1",
      lines: [{ role: "ai", text: "hi" }],
    });
    expect(readEvent("plain words").lines).toEqual([{ role: "ai", text: "plain words" }]);
    expect(readEvent("  ").lines).toEqual([]);
    expect(readEvent('{"type":"turn.started"}').lines).toEqual([]);
  });
});
