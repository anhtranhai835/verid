#!/usr/bin/env node
/**
 * verid's Antigravity hook entry. Antigravity runs it for each event, named in argv, and it hands
 * the payload to verid's hook in this same process: the project's pinned copy (.verid/hooks,
 * repo resources) when there is one, else the bundle installed with this plugin. verid itself
 * reads Antigravity's payloads and answers in Antigravity's format (src/adapters/antigravity.ts);
 * this file only finds it. Outside a verid project every call goes through untouched.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const event = process.argv[2] ?? "";
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let payload = null;
try {
  payload = JSON.parse(raw);
} catch {
  // verid reports an unreadable payload itself, inside a verid project.
}
const project = veridProject(payload?.workspacePaths);
if (project === null) answer({ exit: 0, stdout: pass(event) });
else {
  const here = dirname(fileURLToPath(import.meta.url));
  const runtime = [
    join(project, ".verid", "hooks", "hook-run.js"),
    // Installed by verid setup-antigravity: the bundle sits beside this plugin's entries.
    join(here, "..", "dist", "hook-run.js"),
    // Run from a verid checkout or package: plugin/antigravity/hooks inside it.
    join(here, "..", "..", "..", "dist", "hook-run.js"),
  ].find((file) => existsSync(file));
  if (runtime === undefined)
    answer({
      exit: 0,
      stdout: refuse(
        event,
        "verid [VERID_BURNT_INTERNAL]\nverid's hook runtime is missing: the developer runs verid setup-antigravity.",
      ),
    });
  else {
    const { run } = await import(pathToFileURL(runtime).href);
    answer(await run(raw, ["--provider", "antigravity", "--event", event]));
  }
}

function veridProject(roots) {
  const starts = [...(Array.isArray(roots) ? roots : []), process.cwd()].filter(
    (root) => typeof root === "string" && root !== "",
  );
  for (const start of starts)
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      if (existsSync(join(dir, ".verid"))) return dir;
      if (dirname(dir) === dir) break;
    }
  return null;
}

function pass(name) {
  return `${JSON.stringify(name === "PreToolUse" || name === "Stop" ? { decision: "allow" } : {})}\n`;
}

// No runtime to judge a tool call: it is refused; any other event goes on.
function refuse(name, reason) {
  return name === "PreToolUse" ? `${JSON.stringify({ decision: "deny", reason })}\n` : pass(name);
}

function answer(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exit;
}
