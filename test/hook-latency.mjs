// Times the built hook per tool call, spawned the way Claude Code runs it, and prints median and
// p95 (the design budget is p95 under 200 ms). Run it on Windows after `npm test`.
// The project is a recipe with an approved plan, the slowest path: every write also reads and
// hashes .verid/plan.md and .verid/design.md.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "..", "dist", "hook.js");
const RUNS = 30;
const project = mkdtempSync(join(tmpdir(), "verid-latency-"));
mkdirSync(join(project, ".verid", ".state"), { recursive: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plan = Buffer.from("# Plan\n\n- AC-1: adds two numbers\n");
writeFileSync(join(project, ".verid", "plan.md"), plan);
const design = Buffer.from("# Design\n\nOne module.\n");
writeFileSync(join(project, ".verid", "design.md"), design);
writeFileSync(
  join(project, ".verid", ".state", "state.json"),
  JSON.stringify({
    schemaVersion: 1,
    tdd: { state: "COOKING", last_run: null },
    modules: {
      main: {
        sha256: sha256(plan),
        acs: ["AC-1"],
        at: new Date().toISOString(),
        design_sha256: sha256(design),
      },
    },
  }),
);
writeFileSync(
  join(project, ".verid", "manifest.yaml"),
  'schemaVersion: 1\nmode: recipe\nrepos:\n  - path: .\n    test_cmd: "x {junit}"\n    source_globs: ["src/**"]\n    test_globs: ["test/**"]\n',
);

const calls = {
  Read: { tool_name: "Read", tool_input: { file_path: join(project, "src", "a.ts") } },
  "Write (source)": {
    tool_name: "Write",
    tool_input: { file_path: join(project, "src", "a.ts"), content: "x" },
  },
  "Bash (writes)": { tool_name: "Bash", tool_input: { command: "npm test 2>&1 | tee out.log" } },
};
for (const [name, call] of Object.entries(calls)) {
  const input = JSON.stringify({
    session_id: "s",
    cwd: project,
    hook_event_name: "PreToolUse",
    ...call,
  });
  const ms = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const r = spawnSync(process.execPath, [HOOK], {
      input,
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    });
    if (r.status !== 0) throw new Error(`${name}: hook exited ${r.status}: ${r.stderr}`);
    ms.push(performance.now() - start);
  }
  ms.sort((a, b) => a - b);
  const at = (q) => Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]);
  console.log(`${name.padEnd(15)} median ${at(0.5)} ms · p95 ${at(0.95)} ms (${process.platform})`);
}
rmSync(project, { recursive: true, force: true });
