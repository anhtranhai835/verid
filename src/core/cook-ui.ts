import { stripVTControlCharacters } from "node:util";

/** A 24-bit colour: red, green, blue. */
export type Rgb = [number, number, number];

/** Text in a 24-bit colour, or as it is when colour is off. */
export const paint = (text: string, [r, g, b]: Rgb, color: boolean): string =>
  color ? `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m` : text;

/** A readable wordmark in both colour and plain terminals. */
const WORDMARK = [
  "██╗   ██╗███████╗██████╗ ██╗██████╗ ",
  "██║   ██║██╔════╝██╔══██╗██║██╔══██╗",
  "██║   ██║█████╗  ██████╔╝██║██║  ██║",
  "╚██╗ ██╔╝██╔══╝  ██╔══██╗██║██║  ██║",
  " ╚████╔╝ ███████╗██║  ██║██║██████╔╝",
  "  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝╚═════╝ ",
];

export const bannerLines = (tagline = "hook-enforced TDD", color = false): string[] => [
  "",
  ...WORDMARK.map((row) => paint(row, [255, 165, 0], color)),
  ` 🍳 ${tagline} · RAW → COOKING → PLATED`,
];

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
  /** A heading that opens a new group of commands with this row, after a blank line. */
  group?: string;
}

/** The widest the command table may be in columns; wider rows stack over two lines. */
const USAGE_WIDTH = 100;

/**
 * `verid` alone: the tagline, any notes, then each command, what it does and who runs it, in
 * columns. When the columns would pass USAGE_WIDTH, each row stacks: the command, then the rest.
 */
export function usageLines(
  tagline: string,
  rows: readonly UsageRow[],
  footer: string,
  color: boolean,
  notes: readonly string[] = [],
): string[] {
  const widest = (texts: string[]) => Math.max(...texts.map((s) => [...s].length));
  const cw = widest(rows.map((r) => r.command));
  const ww = widest(rows.map((r) => r.what));
  const columns = 3 + 2 + cw + 2 + ww + 2 + widest(rows.map((r) => r.who ?? ""));
  return [
    ...bannerLines(tagline, color),
    "",
    ...notes.flatMap((note) => [`   ${note}`, ""]),
    ...rows.flatMap((r) => {
      const who = r.who ? paint(r.who, DIM, color) : "";
      const heading = r.group ? ["", `   ${r.group}`] : [];
      if (columns <= USAGE_WIDTH) {
        const command = paint(r.command.padEnd(cw), PICK, color);
        return [...heading, `   ${r.emoji} ${command}  ${r.what.padEnd(ww)}  ${who}`.trimEnd()];
      }
      return [
        ...heading,
        `   ${r.emoji} ${paint(r.command, PICK, color)}`,
        `      ${r.what}  ${who}`.trimEnd(),
      ];
    }),
    "",
    `   ${footer}`,
  ];
}

/** East Asian wide/fullwidth blocks, including supplementary CJK and Kana. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xa960 && code <= 0xa97c) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x16fe0 && code <= 0x18dff) ||
    (code >= 0x1aff0 && code <= 0x1b2ff) ||
    (code >= 0x1f200 && code <= 0x1f251) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** Screen rows occupied by newline-terminated lines; unknown terminal widths keep one per line. */
export function screenRows(lines: readonly string[], columns?: number): number {
  if (columns === undefined || !Number.isFinite(columns) || columns <= 0) return lines.length;
  return lines.reduce((rows, line) => {
    let width = 0;
    const chars = [...stripVTControlCharacters(line)];
    for (const [index, char] of chars.entries()) {
      if (/\p{Mark}|\u200d/u.test(char)) continue;
      const wide =
        /\p{Emoji_Presentation}/u.test(char) ||
        chars[index + 1] === "\ufe0f" ||
        isWide(char.codePointAt(0)!);
      width += wide ? 2 : 1;
    }
    return rows + Math.max(1, Math.ceil(width / columns));
  }, 0);
}

/** The question and the keys to use, then numbered options with the selected one marked ❯. */
export function selectLines(
  question: string,
  options: readonly Option[],
  index: number,
  color: boolean,
): string[] {
  return [
    `${paint("?", PICK, color)} ${question} ${paint(`(↑/↓, 1-${options.length}, Enter)`, DIM, color)}`,
    ...aligned(options, color).map(([label, hint], i) => {
      const numbered = `${i + 1}. ${label}`;
      const line = i === index ? `  ${paint(`❯ ${numbered}`, PICK, color)}` : `    ${numbered}`;
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
