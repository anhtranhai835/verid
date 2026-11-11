import { tempProject } from "../support/project.js";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHook } from "./in-process.js";

/** macOS and Windows file systems ignore case by default; there `.VERID` is `.verid`. */
const caseInsensitive = (() => {
  const dir = mkdtempSync(join(tmpdir(), "verid-case-probe-"));
  try {
    writeFileSync(join(dir, "probe"), "");
    return existsSync(join(dir, "PROBE"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

let project: string;
tempProject("verid-case-", {
  cwd: () => project,
  defaultText: "x",
  bind: (p) => {
    project = p.root;
  },
  setup: (p) => {
    p.put(".verid/.state/state.json", '{"schemaVersion":1}');
    for (const file of [
      ".verid/manifest.yaml",
      ".verid/review/work.md",
      ".git/config",
      "cc/projects/p/s.jsonl",
    ])
      p.put(file);
    p.put(".claude/settings.local.json", "{}");
  },
});

// In process: hook.e2e proves the built hook runs the same code.
async function decision(tool_name: string, rel: string) {
  const r = await runHook(
    JSON.stringify({
      session_id: "case",
      cwd: project,
      hook_event_name: "PreToolUse",
      tool_name,
      tool_input: { file_path: join(project, rel), content: "x" },
    }),
    { CLAUDE_PROJECT_DIR: project, CLAUDE_CONFIG_DIR: join(project, "cc") },
  );
  return r.code === 0 ? "allow" : (/\[(VERID_BURNT_\w+)\]/.exec(r.stderr)?.[1] ?? r.stderr);
}

describe.skipIf(!caseInsensitive)("protected paths on a case-insensitive file system", () => {
  it("denies another spelling of a protected path exactly as its own spelling", async () => {
    const rows = [
      [
        "Read",
        ".verid/.state/state.json",
        ".VERID/.State/STATE.json",
        "VERID_BURNT_STATE_PROTECTED",
      ],
      ["Write", ".verid/.state/new.json", ".Verid/.STATE/new.json", "VERID_BURNT_STATE_PROTECTED"],
      ["Write", ".verid/review/work.md", ".verid/REVIEW/Work.md", "VERID_BURNT_STATE_PROTECTED"],
      ["Write", ".verid/manifest.yaml", ".VERID/Manifest.YAML", "VERID_BURNT_MANIFEST_PROTECTED"],
      [
        "Write",
        ".claude/settings.local.json",
        ".Claude/Settings.Local.json",
        "VERID_BURNT_HOOK_PROTECTED",
      ],
      ["Write", ".git/config", ".GIT/Config", "VERID_BURNT_GIT_INTERNALS"],
      [
        "Read",
        "cc/projects/p/s.jsonl",
        "CC/Projects/p/S.jsonl",
        "VERID_BURNT_TRANSCRIPT_PROTECTED",
      ],
    ] as const;
    const got = [];
    for (const [tool, own, other] of rows)
      got.push([tool, own, other, await decision(tool, own), await decision(tool, other)]);
    expect(got).toEqual(rows.map(([tool, own, other, code]) => [tool, own, other, code, code]));
  });
});
