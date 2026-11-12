import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { parsePlan } from "../../src/core/plan.js";
import { MODULE_INPUTS, readPlan } from "../../src/adapters/plan-file.js";
import { readJUnit } from "../../src/adapters/junit.js";
import { runHook } from "../e2e/in-process.js";
import type { Run } from "./types.js";
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

/**
 * The payloads were recorded on Windows, so a path under a placeholder is written with `\`. On
 * POSIX that is one file name with backslashes in it, not a path: spell it with this system's
 * separator, as Claude Code does there.
 */
const nativePaths = (text: string) =>
  sep === "\\"
    ? text
    : text.replace(/\{\{(?:CWD|HOME)\}\}(?:\\\\[^"\\]+)+/g, (path) => path.replaceAll("\\\\", "/"));

/** A recorded payload with its placeholders filled for `project`, then edited by the test. */
export function claudeFixture(project: string, name: string, edit?: (p: Payload) => void): string {
  const text = nativePaths(readFileSync(join(CLAUDE_FIXTURES, `${name}.json`), "utf8"))
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

export const TEST_ROOT = join(import.meta.dirname, "../..");

export const CLI = join(TEST_ROOT, "dist/cli.js");

export const HOOK = join(TEST_ROOT, "dist/hook.js");

export const RUNNER = join(import.meta.dirname, "../e2e/fake-runner.mjs");

export const FRESH_STATE = '{"schemaVersion":1,"baseline":[]}';

export const verdict = (r: Run) =>
  r.code === 0 ? "exit 0" : /verid \[(\w+)\]/.exec(r.stderr)?.[1];

let english: Record<string, string> | undefined;

export const enMessage = (key: string, params: Record<string, string>) => {
  english ??= JSON.parse(readFileSync(join(TEST_ROOT, "i18n/en.json"), "utf8"));
  return (english![key] ?? key).replace(
    /\{(\w+)\}/g,
    (match, name: string) =>
      params[name] ?? (name === "verid" ? `node "${CLI.replaceAll("\\", "/")}"` : match),
  );
};

export const told = (r: Run | undefined, key: string, params: Record<string, string>) =>
  r?.code === 0 &&
  String((JSON.parse(r.stdout || "{}") as Payload).systemMessage).includes(enMessage(key, params));

export const readJUnitFixture = (name: string): ReturnType<typeof readJUnit> =>
  readJUnit(join(TEST_ROOT, "test/fixtures/junit", name));
