import type { MessageKey } from "../core/errors.js";
import { parseArgs } from "node:util";
import { usageLines, type UsageRow } from "../core/cook-ui.js";
import { t, veridName, type Lang } from "../adapters/i18n.js";
import { loadManifest } from "../adapters/manifest.js";
import { menuLines } from "../adapters/plan-file.js";
import { languageOf, readState, statePaths } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";
import { COOK_OPTIONS, UPGRADE_OPTIONS } from "./cook-flags.js";
import { interactive, systemLang } from "./shell.js";

type Misuse = { key: MessageKey; params: Record<string, string> };

// How many arguments each command takes after its name; cook takes flags.
const ARGS: Record<string, number> = {
  usage: 2,
  context: 3,
  module: 1,
  doctor: 0,
  taste: 0,
  peek: 0,
  menu: 0,
  garnish: 0,
  resume: 0,
  stock: 0,
  order: 1,
  serve: 1,
  board: 0,
};

/** What verid could not run in a command line: the command, or the words it did not expect. */
export function misused(cmd: string, rest: string[]): Misuse {
  if (cmd === "cook" || cmd === "upgrade") {
    const options = cmd === "upgrade" ? UPGRADE_OPTIONS : COOK_OPTIONS;
    const { tokens } = parseArgs({
      args: rest,
      options,
      strict: false,
      tokens: true,
    });
    const odd = tokens.flatMap((tk) =>
      tk.kind === "positional"
        ? [tk.value]
        : tk.kind === "option" && !(tk.name in options)
          ? [tk.rawName]
          : [],
    );
    return {
      key: "usage.unexpected",
      params: { command: cmd, args: (odd.length > 0 ? odd : rest).join(" ") },
    };
  }
  if (cmd === "reheat")
    return { key: "usage.unexpected", params: { command: cmd, args: rest.join(" ") || "(none)" } };
  const max = ARGS[cmd];
  if (max === undefined) return { key: "usage.unknown", params: { command: cmd } };
  if (cmd === "serve" && rest.length === 0) return { key: "usage.no_module", params: {} };
  return { key: "usage.unexpected", params: { command: cmd, args: rest.slice(max).join(" ") } };
}

/**
 * `verid` alone, or asking for help: the commands as a menu, on stdout. A command line verid
 * cannot run gets the same menu as a refusal, on stderr, below what it did not understand.
 * Before cook has set a language, the system's is used: a table in two languages at once would
 * be hard to read.
 */
export function usage(project: string, wrong: Misuse | null, next?: string): CliResult {
  const lang: Lang = languageOf(project) ?? systemLang();
  const say = (key: MessageKey) => t(lang, key, {});
  // The table reads `verid`; when verid is not on PATH one line above it names what runs it.
  const full = veridName();
  const v = "verid";
  const dev = say("usage.developer");
  // Outside a real terminal, cook asks nothing and needs the mode: never point to what fails.
  const cook = interactive() ? `${v} cook` : `${v} cook --mode <prep|recipe|remix>`;
  const rows: UsageRow[] = [
    // The three everyday commands first, then the gate commands as a second group.
    { emoji: "🔪", command: cook, what: say("usage.cook"), who: dev },
    { emoji: "🩺", command: `${v} doctor [--ci]`, what: say("usage.doctor") },
    { emoji: "📋", command: `${v} menu [--commits [--file [--compact]]]`, what: say("usage.menu") },
    {
      emoji: "⬆️",
      command: `${v} upgrade [--dry-run] [--yes]`,
      what: say("usage.upgrade"),
      who: dev,
      group: say("usage.group"),
    },
    {
      emoji: "📁",
      command: `${v} module <name> [--quick|--fix]`,
      what: say("usage.module"),
      who: "prep, recipe",
    },
    { emoji: "👅", command: `${v} taste`, what: say("usage.taste") },
    { emoji: "👀", command: `${v} peek`, what: say("usage.peek") },
    { emoji: "📊", command: `${v} usage [module] [--json]`, what: say("usage.ledger") },
    { emoji: "🗂️", command: `${v} context [module] [--ac <id>]`, what: say("usage.context") },
    {
      emoji: "▦",
      command: `${v} board [--port <number>] [--no-open]`,
      what: say("usage.board"),
      who: dev,
    },
    {
      emoji: "🧾",
      command: `${v} order [module]`,
      what: say("usage.order"),
      who: `${dev} · prep, recipe`,
    },
    {
      emoji: "🍽️",
      command: `${v} serve <module>`,
      what: say("usage.serve"),
      who: `${dev} · prep, recipe`,
    },
    { emoji: "🥫", command: `${v} stock`, what: say("usage.stock"), who: `${dev} · remix` },
    { emoji: "🌿", command: `${v} garnish`, what: say("usage.garnish"), who: dev },
    { emoji: "🛑", command: `${v} halt [reason]`, what: say("usage.halt"), who: dev },
    { emoji: "▶️", command: `${v} resume`, what: say("usage.resume"), who: dev },
  ];
  rows.push({
    emoji: "🍳",
    command: `${v} station <module>|list|close <module>`,
    what: say("usage.station"),
    who: dev,
  });
  rows.push({
    emoji: "🔥",
    command: `${v} reheat <inventory|extract <unit>|gate <unit>>`,
    what: say("usage.reheat"),
    who: "reheat",
  });
  rows.push({
    emoji: "🧩",
    command: `${v} plugin <add|remove|list|doctor>`,
    what: say("usage.plugin"),
    who: dev,
  });
  const tty = wrong ? process.stderr.isTTY : process.stdout.isTTY;
  const color = Boolean(tty) && !process.env.NO_COLOR;
  const notes = [...(next ? [next] : []), ...(full === v ? [] : [`${v} = ${full}`])];
  const lines = usageLines(say("usage.tagline"), rows, say("usage.in_claude"), color, notes);
  lines.push("", `   ${say("usage.cook_options")}`);
  if (!wrong) return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  const text = [t(lang, wrong.key, wrong.params), ...lines].join("\n");
  return { exit: 2, stdout: "", stderr: `${text}\n` };
}

/** The last line of `verid menu`, or nothing when there is no usable plan: help never fails on it. */
export async function helpNextStep(project: string): Promise<string | undefined> {
  try {
    const manifest = await loadManifest(project);
    if (!manifest) return undefined;
    const state = readState(statePaths(project));
    return menuLines(project, manifest.mode, state, manifest.roles, manifest.drive, manifest).at(
      -1,
    );
  } catch {
    return undefined;
  }
}
