import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePlan } from "../../src/core/plan.js";
import { MODULE_INPUTS, readPlan } from "../../src/adapters/plan-file.js";
import { runHook } from "./in-process.js";

/**
 * A developer's terminal: this process's environment without CLAUDE_* variables, so the test
 * machine's own session leaks nothing. Variables starting with an `also` prefix go too.
 */
export const developerEnv = (...also: string[]): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !["CLAUDE", ...also].some((prefix) => key.startsWith(prefix)),
    ),
  );

/** Real Claude Code hook stdin, recorded once, with {{CWD}}, {{HOME}} and {{SESSION_ID}} placeholders. */
export const CLAUDE_FIXTURES = join(import.meta.dirname, "..", "fixtures", "claude-code");
export const FIXTURE_SESSION = "11111111-2222-3333-4444-555555555555";
export type Payload = Record<string, any>;
const esc = (s: string) => JSON.stringify(s).slice(1, -1);

/** A recorded payload with its placeholders filled for `project`, then edited by the test. */
export function claudeFixture(project: string, name: string, edit?: (p: Payload) => void): string {
  const text = readFileSync(join(CLAUDE_FIXTURES, `${name}.json`), "utf8")
    // A replacer function: a string replacement would turn the `$$` in a project path into `$`.
    .replaceAll("{{CWD}}", () => esc(project))
    .replaceAll("{{HOME}}", esc(homedir()))
    .replaceAll("{{SESSION_ID}}", FIXTURE_SESSION)
    .replaceAll(/\{\{[A-Z_]+\}\}/g, "placeholder");
  const payload = JSON.parse(text) as Payload;
  edit?.(payload);
  return JSON.stringify(payload);
}

/** Legacy feature fixtures still exercise real dossier hashing and approval gates in v2. */
export function readyModulePlan(project: string, text: string): string {
  const parsed = parsePlan(text);
  if (!parsed.ok) return text;
  for (const module of parsed.modules) {
    const base = `.verid/artifacts/03-modules/${module.name}`;
    for (const input of MODULE_INPUTS) {
      const file = join(project, base, input);
      mkdirSync(join(file, ".."), { recursive: true });
      if (!existsSync(file) || readFileSync(file, "utf8").includes("[NEEDS CLARIFICATION"))
        writeFileSync(file, `Agreed ${module.name}: ${input}\n`);
    }
    if (!/^Artifacts:/m.test(module.text)) {
      const section =
        module.text + (module.text.endsWith("\n") ? "" : "\n") + `Artifacts: ${base}\n`;
      text = text.replace(module.text, () => section);
    }
  }
  return text;
}

export function moduleHash(project: string, name: string): string {
  const plan = readPlan(project, false, true);
  if (!plan?.ok || !plan.hashes[name]) throw new Error(`invalid fixture module: ${name}`);
  return plan.hashes[name];
}

/** A real startup after terminal order, never a fabricated session claim in state. */
export function startTaskSession(
  project: string,
  session = FIXTURE_SESSION,
  provider = "claude-code",
) {
  if (provider === "antigravity")
    return runHook(
      JSON.stringify({ conversationId: session, workspacePaths: [project], source: "startup" }),
      {},
      ["--provider", "antigravity", "--event", "SessionStart"],
    );
  return runHook(
    JSON.stringify({
      hook_event_name: "SessionStart",
      cwd: project,
      session_id: session,
      source: "startup",
      model: "test",
      transcript_path: null,
      permission_mode: "default",
    }),
    {},
    provider === "claude-code" ? [] : ["--provider", provider],
  );
}
