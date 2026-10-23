/** A 24-bit colour: red, green, blue. */
export type Rgb = [number, number, number];

/** The warm gradient of the banner, one colour per letter: tomato to teal. */
export const GRADIENT: Rgb[] = [
  [255, 99, 71],
  [255, 165, 0],
  [255, 215, 0],
  [60, 179, 113],
  [0, 168, 168],
];

/** V, E, R, I and D, 8 rows each; every row of a letter has the same width. */
export const BANNER_LETTERS: string[][] = [
  [
    "██╗     ██╗",
    "██║     ██║",
    "██║     ██║",
    "██║     ██║",
    "╚██╗   ██╔╝",
    " ╚██╗ ██╔╝ ",
    "  ╚████╔╝  ",
    "   ╚═══╝   ",
  ],
  [
    "████████╗",
    "██╔═════╝",
    "██║      ",
    "██████╗  ",
    "██╔═══╝  ",
    "██║      ",
    "████████╗",
    "╚═══════╝",
  ],
  [
    "███████╗ ",
    "██╔═══██╗",
    "██║   ██║",
    "███████╔╝",
    "██╔══██╗ ",
    "██║  ╚██╗",
    "██║   ██║",
    "╚═╝   ╚═╝",
  ],
  ["██╗", "██║", "██║", "██║", "██║", "██║", "██║", "╚═╝"],
  [
    "███████╗ ",
    "██╔═══██╗",
    "██║   ██║",
    "██║   ██║",
    "██║   ██║",
    "██║   ██║",
    "███████╔╝",
    "╚══════╝ ",
  ],
];

const TAGLINE = "        hook-enforced TDD · RAW → COOKING → PLATED";

/** Text in a 24-bit colour, or as it is when colour is off. */
export const paint = (text: string, [r, g, b]: Rgb, color: boolean): string =>
  color ? `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m` : text;

/** The banner's 8 rows, each letter in its own colour when colour is on, then the tagline. */
export function bannerLines(color: boolean): string[] {
  const rows = (BANNER_LETTERS[0] ?? []).map(
    (_, row) =>
      ` ${BANNER_LETTERS.map((letter, i) =>
        paint(letter[row] ?? "", GRADIENT[i] ?? [255, 255, 255], color),
      ).join("  ")}`,
  );
  return [...rows, TAGLINE];
}

export type Key = "up" | "down" | "enter" | "cancel" | "other";

/** What a chunk read from the terminal in raw mode means for a select list. */
export function keyOf(chunk: string): Key {
  if (chunk === "\x1b[A" || chunk === "k") return "up";
  if (chunk === "\x1b[B" || chunk === "j") return "down";
  if (chunk === "\r" || chunk === "\n") return "enter";
  if (chunk === "\x03") return "cancel";
  return "other";
}

/** Keys typed fast arrive in one chunk: each escape sequence or character is a key of its own. */
export const keysOf = (chunk: string): Key[] =>
  (chunk.match(/\x1b\[[A-D]|\x1b.?|[\s\S]/g) ?? []).map(keyOf);

/** The selected index after a key, wrapping at both ends. */
export function move(index: number, key: Key, count: number): number {
  if (key === "up") return (index - 1 + count) % count;
  if (key === "down") return (index + 1) % count;
  return index;
}

export interface Option {
  label: string;
  hint?: string;
}

const PICK: Rgb = [255, 165, 0];
const DIM: Rgb = [150, 150, 150];

/** Each label padded to the widest, counted in characters (emoji are one), and its hint. */
function aligned(options: readonly Option[], color: boolean): [string, string][] {
  const width = Math.max(...options.map((o) => [...o.label].length));
  return options.map((o) => [
    o.label.padEnd(width + o.label.length - [...o.label].length),
    o.hint ? `  ${paint(o.hint, DIM, color)}` : "",
  ]);
}

export interface UsageRow {
  emoji: string;
  command: string;
  what: string;
  /** Who runs it and in which modes, when not anyone in any mode. */
  who?: string;
}

/** `verid` alone: the tagline, then each command, what it does and who runs it, in columns. */
export function usageLines(
  tagline: string,
  rows: readonly UsageRow[],
  footer: string,
  color: boolean,
): string[] {
  const widest = (texts: string[]) => Math.max(...texts.map((s) => [...s].length));
  const cw = widest(rows.map((r) => r.command));
  const ww = widest(rows.map((r) => r.what));
  return [
    ` 🍳 verid · ${tagline} · RAW → COOKING → PLATED`,
    "",
    ...rows.map((r) => {
      const command = paint(r.command.padEnd(cw), PICK, color);
      const who = r.who ? paint(r.who, DIM, color) : "";
      return `   ${r.emoji} ${command}  ${r.what.padEnd(ww)}  ${who}`.trimEnd();
    }),
    "",
    `   ${footer}`,
  ];
}

/** The question and the keys to use, then one line per option, the selected one marked ❯. */
export function selectLines(
  question: string,
  options: readonly Option[],
  index: number,
  color: boolean,
): string[] {
  return [
    `${paint("?", PICK, color)} ${question} ${paint("(↑/↓, Enter)", DIM, color)}`,
    ...aligned(options, color).map(([label, hint], i) => {
      const line = i === index ? `  ${paint(`❯ ${label}`, PICK, color)}` : `    ${label}`;
      return `${line}${hint}`.trimEnd();
    }),
  ];
}

/** The question, the options numbered from 1 with the ticked ones marked ◉, then how to answer. */
export function pickLines(
  question: string,
  options: readonly Option[],
  ticked: readonly number[],
  how: string,
  color: boolean,
): string[] {
  return [
    question,
    ...aligned(options, color).map(([label, hint], i) => {
      const mark = ticked.includes(i) ? paint("◉", PICK, color) : "◯";
      return `    ${mark} ${i + 1}. ${label}${hint}`.trimEnd();
    }),
    `  ${how}`,
  ];
}

/**
 * An answer to `pickLines`, comma-separated: a number picks that option's glob, anything else is
 * a glob. A bare folder name (no wildcard, no dot in its last part) or a trailing slash means
 * everything in the folder: `src` alone would match only a file named src, and no code at all.
 * The globs come in the order typed, each once; `part` is the first number not in the list.
 */
export function parsePick(
  answer: string,
  globs: readonly string[],
): { ok: true; globs: string[] } | { ok: false; part: string } {
  const parts = answer
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return { ok: false, part: answer };
  const picked: string[] = [];
  for (const part of parts) {
    const glob = /^\d+$/.test(part) ? globs[Number(part) - 1] : folderGlob(part);
    if (glob === undefined) return { ok: false, part };
    if (!picked.includes(glob)) picked.push(glob);
  }
  return { ok: true, globs: picked };
}

function folderGlob(part: string): string {
  if (/[*?]/.test(part)) return part;
  const bare = part.replace(/[\\/]+$/, "");
  const last = bare.split(/[\\/]/).pop() ?? "";
  return bare !== part || !last.includes(".") ? `${bare}/**` : part;
}
