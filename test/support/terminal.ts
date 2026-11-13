import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Io } from "../../src/adapters/terminal.js";
export const ENTER = "\r";
export const UP = "\x1b[A";
export const DOWN = "\x1b[B";
export const CTRL_C = "\x03";
/** Keys enter through input; output records exactly what the terminal draws. */
export function fakeTerminal() {
  const raw: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (on: boolean) => raw.push(on),
  });
  const output = new PassThrough();
  let drawn = "";
  output.on("data", (d) => (drawn += d));
  const interrupts = new EventEmitter();
  const io: Io = { input, output, color: false, interrupts };
  return {
    io,
    raw,
    type: (keys: string) => input.write(keys),
    interrupt: () => interrupts.emit("SIGINT"),
    text: () => drawn,
  };
}
/** Answer cook prompts as they are drawn, allowing filesystem changes between keys. */
export function scriptedTerminal(
  keys: (string | (() => string))[],
  /** One answer for every providers question, or one per question in order (then Enter). */
  providerKeys: string | string[] = ENTER,
  architectureKeys = ENTER,
  layoutKeys: string | (string | (() => string))[] = ENTER,
  resourceKeys = ENTER,
  /** Answers the first Apply question, e.g. to open cook's "Change settings". */
  firstApply?: string,
) {
  const t = fakeTerminal();
  t.io.output.on("data", (d) => {
    if (firstApply !== undefined && /\? (Apply\?|Áp dụng\?)/.test(String(d))) {
      const next = firstApply;
      firstApply = undefined;
      setImmediate(() => t.type(next));
      return;
    }
    if (/\? (How are your repositories organized|Repo của bạn tổ chức thế nào)/.test(String(d))) {
      const next = Array.isArray(layoutKeys) ? (layoutKeys.shift() ?? ENTER) : layoutKeys;
      setImmediate(() => t.type(typeof next === "function" ? next() : next));
      return;
    }
    if (/\? (Where should cook resources live|Lưu tài nguyên cook ở đâu)/.test(String(d))) {
      setImmediate(() => t.type(resourceKeys));
      return;
    }
    if (/(^|\n|\x1b\[0J)\? (Choose providers|Chọn provider)/.test(String(d))) {
      const next = Array.isArray(providerKeys) ? (providerKeys.shift() ?? ENTER) : providerKeys;
      setImmediate(() => t.type(next));
      return;
    }
    if (/\? (Project architecture|Kiến trúc dự án)/.test(String(d))) {
      setImmediate(() => t.type(architectureKeys));
      return;
    }
    if (/(^|\n|\x1b\[0J)\? /.test(String(d)) && keys.length > 0) {
      const next = keys.shift() as string | (() => string);
      setImmediate(() => t.type(typeof next === "function" ? next() : next));
    }
  });
  return { io: t.io, screen: t.text, interrupt: t.interrupt };
}
