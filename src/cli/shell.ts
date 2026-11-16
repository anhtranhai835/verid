import { readFileSync } from "node:fs";
import { isCi } from "../core/setup-plan.js";
import type { Lang } from "../adapters/i18n.js";
import type { Io } from "../adapters/terminal.js";

/**
 * A person at a real terminal: never in a pipe or CI, where a prompt would wait forever, nor in a
 * dumb terminal, which cannot redraw a list.
 */
export const hasTerminal = () =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isCi(process.env.CI);

export const interactive = () => hasTerminal() && process.env.TERM !== "dumb";

/** The developer's terminal; colour unless NO_COLOR is set to something (no-color.org). */
export const terminalIo = (): Io => ({
  input: process.stdin,
  output: process.stdout,
  color: !process.env.NO_COLOR,
  interrupts: process,
});

export const locale = () => Intl.DateTimeFormat().resolvedOptions().locale;

export const systemLang = (): Lang => (locale().toLowerCase().startsWith("vi") ? "vi" : "en");

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // missing or broken: it registers nothing
  }
}
