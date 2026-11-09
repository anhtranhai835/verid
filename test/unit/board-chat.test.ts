import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_ALLOW, launchFor, readEvent, windowsArgs } from "../../src/adapters/board-chat.js";

const project = mkdtempSync(join(tmpdir(), "verid-chat-"));

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
