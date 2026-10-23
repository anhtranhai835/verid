import { describe, expect, it } from "vitest";
import {
  guardsToolCalls,
  hasVeridHooks,
  withVeridHooks,
} from "../../src/adapters/claude-settings.js";

const HOOK = "C:/tools/verid/dist/hook.js";

// The handlers of the manual checklist, one per event.
const handler = (event: string, path = HOOK) => ({
  type: "command",
  command: "node",
  args: [path],
  timeout: 10,
  ...(event === "PreToolUse" && { onFailure: "block" }),
});
const veridHooks = (path = HOOK) => ({
  PreToolUse: [{ matcher: "*", hooks: [handler("PreToolUse", path)] }],
  UserPromptSubmit: [{ hooks: [handler("UserPromptSubmit", path)] }],
  Stop: [{ hooks: [handler("Stop", path)] }],
  SubagentStop: [{ hooks: [handler("SubagentStop", path)] }],
  SessionStart: [{ hooks: [handler("SessionStart", path)] }],
});

describe("withVeridHooks", () => {
  it("adds the five handlers to empty settings", () => {
    expect(withVeridHooks({}, HOOK)).toEqual({
      settings: { hooks: veridHooks() },
      changed: true,
    });
  });

  it("changes nothing the second time", () => {
    expect(withVeridHooks({ hooks: veridHooks() }, HOOK)).toEqual({
      settings: { hooks: veridHooks() },
      changed: false,
    });
  });

  it("keeps the developer's other settings and hooks", () => {
    const lint = { matcher: "Bash", hooks: [{ type: "command", command: "lint.sh" }] };
    expect(
      withVeridHooks(
        {
          permissions: { allow: ["Bash(npm test)"] },
          hooks: { PreToolUse: [lint], PostToolUse: [lint] },
        },
        HOOK,
      ),
    ).toEqual({
      settings: {
        permissions: { allow: ["Bash(npm test)"] },
        hooks: {
          ...veridHooks(),
          PreToolUse: [lint, ...veridHooks().PreToolUse],
          PostToolUse: [lint],
        },
      },
      changed: true,
    });
  });

  it("replaces handlers that point at another verid, in any path style", () => {
    const keep = { type: "command", command: "audit.sh" };
    for (const old of [
      "D:/old/verid/dist/hook.js",
      "D:\\old\\verid\\dist\\hook.js",
      "/opt/verid/dist/hook.js",
    ])
      expect(
        withVeridHooks(
          {
            hooks: {
              PreToolUse: [{ matcher: "*", hooks: [handler("PreToolUse", old)] }],
              Stop: [{ hooks: [handler("Stop", old), keep] }],
            },
          },
          HOOK,
        ),
        old,
      ).toEqual({
        settings: { hooks: { ...veridHooks(), Stop: [{ hooks: [keep] }, ...veridHooks().Stop] } },
        changed: true,
      });
  });

  it("refuses settings it cannot merge into, saying where", () => {
    const rows: [unknown, string][] = [
      [[], "settings: expected a JSON object"],
      [null, "settings: expected a JSON object"],
      [{ hooks: [] }, "hooks: expected a JSON object"],
      [{ hooks: { Stop: {} } }, "hooks.Stop: expected a list"],
    ];
    for (const [settings, detail] of rows)
      expect(() => withVeridHooks(settings, HOOK)).toThrow(detail);
  });
});

describe("hasVeridHooks", () => {
  it("finds verid's handlers, and nothing in other hooks or non-settings", () => {
    expect([
      hasVeridHooks({ hooks: veridHooks() }),
      hasVeridHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "audit.sh" }] }] } }),
      hasVeridHooks({}),
      hasVeridHooks("not settings"),
    ]).toEqual([true, false, false, false]);
  });
});

describe("guardsToolCalls: this verid's PreToolUse hook is registered and fails closed", () => {
  const without = (h: Record<string, unknown>, key: string) =>
    Object.fromEntries(Object.entries(h).filter(([k]) => k !== key));

  it("is true only for this verid's PreToolUse handler with onFailure block", () => {
    const rows: [string, unknown, boolean][] = [
      ["what verid cook writes", { hooks: veridHooks() }, true],
      ["another verid", { hooks: veridHooks("D:/old/verid/dist/hook.js") }, false],
      [
        "no onFailure: a crash would let the tool run",
        {
          hooks: {
            ...veridHooks(),
            PreToolUse: [{ matcher: "*", hooks: [without(handler("PreToolUse"), "onFailure")] }],
          },
        },
        false,
      ],
      ["only the lifecycle hooks", { hooks: without(veridHooks(), "PreToolUse") }, false],
      ["nothing", {}, false],
      ["not settings", "nope", false],
    ];
    expect(Object.fromEntries(rows.map(([name, s]) => [name, guardsToolCalls(s, HOOK)]))).toEqual(
      Object.fromEntries(rows.map(([name, , want]) => [name, want])),
    );
  });
});
