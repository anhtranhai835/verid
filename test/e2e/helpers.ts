import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
