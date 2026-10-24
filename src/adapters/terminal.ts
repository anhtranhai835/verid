import { createInterface } from "node:readline";
import { keysOf, move, selectLines, type Option } from "../core/cook-ui.js";

/** The developer's terminal: keys in, screen out, and whether colour may be used. */
export interface Io {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown };
  output: NodeJS.WritableStream;
  color: boolean;
  /** Where Ctrl+C arrives outside raw mode, as SIGINT: the process, in a real terminal. */
  interrupts?: NodeJS.EventEmitter;
}

/**
 * Asks for one of `options` with the arrow keys (or j/k) and Enter. Resolves the index, or null
 * on Ctrl+C. Raw mode is on only while the list is shown, and off again however it ends.
 */
export function select(
  io: Io,
  question: string,
  options: readonly Option[],
  initial: number,
  shortcuts: Readonly<Record<string, number>> = {},
): Promise<number | null> {
  return new Promise((resolve) => {
    let index = initial;
    let drawn = 0;
    const draw = () => {
      const lines = selectLines(question, options, index, io.color);
      // Back to the first line of the last drawing, clear down, draw again.
      io.output.write(`${drawn > 0 ? `\x1b[${drawn}A\x1b[0J` : ""}${lines.join("\n")}\n`);
      drawn = lines.length;
    };
    const done = (picked: number | null) => {
      io.input.removeListener("data", onData);
      io.input.setRawMode?.(false);
      io.input.pause();
      resolve(picked);
    };
    // Keys typed fast arrive together; the first Enter or Ctrl+C ends the list, the rest is dropped.
    const onData = (chunk: Buffer | string) => {
      const shortcut = shortcuts[chunk.toString().trim().toLowerCase()];
      if (shortcut !== undefined) return done(shortcut);
      for (const key of keysOf(chunk.toString())) {
        if (key === "enter") return done(index);
        if (key === "cancel") return done(null);
        index = move(index, key, options.length);
      }
      draw();
    };
    io.input.setRawMode?.(true);
    io.input.resume();
    io.input.on("data", onData);
    draw();
  });
}

/** Asks for one line of text. Resolves it trimmed (empty for Enter alone), or null on Ctrl+C. */
export function ask(io: Io, question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: io.input, output: io.output, terminal: false });
    let answered = false;
    // Outside raw mode, Ctrl+C is a signal: it cancels the question instead of ending verid.
    const interrupted = () => rl.close();
    io.interrupts?.once("SIGINT", interrupted);
    rl.on("close", () => {
      io.interrupts?.removeListener("SIGINT", interrupted);
      if (!answered) resolve(null);
    });
    rl.question(`? ${question} `, (line) => {
      answered = true;
      rl.close();
      resolve(line.trim());
    });
  });
}
