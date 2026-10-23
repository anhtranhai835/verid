import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ask, select, type Io } from "../../src/adapters/terminal.js";

/** A terminal stand-in: keys go in through `input`, what verid draws comes out of `text()`. */
function fakeTerminal() {
  const raw: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (on: boolean) => raw.push(on),
  });
  const output = new PassThrough();
  let drawn = "";
  output.on("data", (d) => (drawn += d));
  // Ctrl+C outside raw mode is a signal, not a key: it arrives here.
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

describe("select: one option out of a list, with the arrow keys", () => {
  it("returns the option picked with the arrows and Enter, or null on Ctrl+C, and leaves raw mode", async () => {
    const rows: [string[], number, number | null][] = [
      [["\x1b[B", "\r"], 0, 1],
      [["\x1b[A", "\r"], 0, 2],
      [["\r"], 1, 1],
      [["\x03"], 1, null],
    ];
    const got = [];
    for (const [keys, initial] of rows) {
      const t = fakeTerminal();
      const picked = select(
        t.io,
        "Pick?",
        [{ label: "a" }, { label: "b" }, { label: "c" }],
        initial,
      );
      for (const k of keys) t.type(k);
      got.push([await picked, t.raw]);
    }
    expect(got).toEqual(rows.map(([, , want]) => [want, [true, false]]));
  });

  it("draws the question and redraws the list on each move", async () => {
    const t = fakeTerminal();
    const picked = select(t.io, "Pick?", [{ label: "a" }, { label: "b" }], 0);
    t.type("\x1b[B");
    t.type("\r");
    await picked;
    expect(t.text()).toContain("? Pick? (↑/↓, Enter)\n  ❯ a\n    b\n");
    expect(t.text()).toContain("\x1b[3A\x1b[0J? Pick? (↑/↓, Enter)\n    a\n  ❯ b\n");
  });
});

describe("ask: a line of free text", () => {
  it("returns the typed line, empty when only Enter is pressed, or null on Ctrl+C", async () => {
    const got = [];
    for (const answerWith of ["npx vitest run {junit}\n", "\n", "Ctrl+C"]) {
      const t = fakeTerminal();
      const answer = ask(t.io, "Command?");
      if (answerWith === "Ctrl+C") t.interrupt();
      else t.type(answerWith);
      got.push(await answer);
    }
    expect(got).toEqual(["npx vitest run {junit}", "", null]);
  });
});
