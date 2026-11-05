import { expect, it } from "vitest";
import { decide } from "../../src/core/policy.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mcpFiles, policyContext, toAction } from "../../src/adapters/claude-code.js";

it.skipIf(process.platform !== "win32")(
  "protects every rule from NTFS stream aliases before path matching",
  () => {
    const project = mkdtempSync(join(tmpdir(), "verid-stream-policy-"));
    const rows = [
      [".claude/settings.json::$DATA", ".claude/settings.json", "VERID_BURNT_HOOK_PROTECTED"],
      [".verid/.state::$INDEX_ALLOCATION/x", ".verid/.state/x", "VERID_BURNT_STATE_PROTECTED"],
      [".verid/manifest.yaml::$DATA", ".verid/manifest.yaml", "VERID_BURNT_MANIFEST_PROTECTED"],
      [".env::$DATA", ".env", "VERID_BURNT_SECRET_PROTECTED"],
    ] as const;
    try {
      for (const existing of [false, true]) {
        for (const [path, plain, expected] of rows) {
          if (existing) {
            mkdirSync(dirname(join(project, plain)), { recursive: true });
            writeFileSync(join(project, plain), "fixture");
          }
          for (const tool of ["Write", "mcp__filesystem__write_file"]) {
            const payload = {
              hook_event_name: "PreToolUse" as const,
              session_id: "streams",
              cwd: project,
              tool_name: tool,
              tool_input: { file_path: path, path },
            };
            const action = tool === "Write" ? toAction(payload) : mcpFiles(payload)[0]!;
            expect("invalid" in action).toBe(false);
            if ("invalid" in action) continue;
            const result = decide(action, policyContext(project));
            expect
              .soft(
                result.kind === "deny" ? result.code : result.kind,
                `${tool} ${path} existing=${existing}`,
              )
              .toBe(expected);
          }
        }
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  },
);
