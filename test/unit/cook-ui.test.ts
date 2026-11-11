import { describe, expect, it } from "vitest";
import {
  bannerLines,
  keyOf,
  keysOf,
  move,
  paint,
  parsePick,
  pickLines,
  selectLines,
  usageLines,
} from "../../src/core/cook-ui.js";

describe("bannerLines: the banner of verid cook", () => {
  it("shows a large VERID wordmark in plain and colour terminals", () => {
    const plain = bannerLines();
    expect(plain).toHaveLength(8);
    expect(plain[1]).toContain("██╗   ██╗███████╗");
    expect(plain[7]).toBe(" 🍳 hook-enforced TDD · RAW → COOKING → PLATED");
    expect(bannerLines(undefined, true)[1]).toContain("\x1b[38;2;255;165;0m");
  });
});

describe("paint", () => {
  it("wraps text in a 24-bit colour, or leaves it as it is", () => {
    expect([paint("x", [1, 2, 3], true), paint("x", [1, 2, 3], false)]).toEqual([
      "\x1b[38;2;1;2;3mx\x1b[0m",
      "x",
    ]);
  });
});

describe("keyOf and move: the select list", () => {
  it("reads the arrows, j and k, Enter and Ctrl+C", () => {
    expect(["\x1b[A", "k", "\x1b[B", "j", "\r", "\n", "\x03", "x"].map(keyOf)).toEqual([
      "up",
      "up",
      "down",
      "down",
      "enter",
      "enter",
      "cancel",
      "other",
    ]);
  });

  it("splits keys typed fast, which arrive together, one key each", () => {
    expect({
      "k Enter": keysOf("k\r"),
      "up up Enter": keysOf("\x1b[A\x1b[A\r"),
      "down Ctrl+C": keysOf("j\x03"),
    }).toEqual({
      "k Enter": ["up", "enter"],
      "up up Enter": ["up", "up", "enter"],
      "down Ctrl+C": ["down", "cancel"],
    });
  });

  it("moves through the options and wraps at both ends", () => {
    expect({
      "down from the last": move(2, "down", 3),
      "up from the first": move(0, "up", 3),
      down: move(0, "down", 3),
      "another key": move(1, "other", 3),
    }).toEqual({ "down from the last": 0, "up from the first": 2, down: 1, "another key": 1 });
  });

  it("marks the selected option, shows each hint beside its label and the keys to use", () => {
    expect(
      selectLines("Pick?", [{ label: "prep", hint: "new" }, { label: "remix" }], 1, false),
    ).toEqual(["? Pick? (↑/↓, 1-2, Enter)", "    1. prep   new", "  ❯ 2. remix"]);
  });
});

describe("usageLines: the commands, as a menu", () => {
  it("aligns each command, what it does and who runs it, under the banner's tagline", () => {
    const rows = [
      { emoji: "🔪", command: "verid cook", what: "set verid up", who: "developer" },
      { emoji: "👅", command: "verid taste", what: "run the tests" },
    ];
    expect(usageLines("hook-enforced TDD", rows, "In Claude Code, type /verid:", false)).toEqual([
      ...bannerLines(),
      "",
      "   🔪 verid cook   set verid up   developer",
      "   👅 verid taste  run the tests",
      "",
      "   In Claude Code, type /verid:",
    ]);
  });

  it("opens a second group of commands with a blank line and its heading", () => {
    const rows = [
      { emoji: "🔪", command: "verid cook", what: "set verid up" },
      { emoji: "👅", command: "verid taste", what: "run the tests", group: "Gate commands:" },
    ];
    expect(usageLines("t", rows, "footer", false).slice(-6)).toEqual([
      "   🔪 verid cook   set verid up",
      "",
      "   Gate commands:",
      "   👅 verid taste  run the tests",
      "",
      "   footer",
    ]);
  });

  it("puts notes above the commands and stacks rows that would pass 100 columns", () => {
    const rows = [
      {
        emoji: "🔪",
        command: "verid cook --mode <prep|recipe|remix>",
        what: "w".repeat(50),
        who: "developer · prep, recipe",
      },
      { emoji: "👅", command: "verid taste", what: "run the tests" },
    ];
    const lines = usageLines("t", rows, "footer", false, ["verid = node cli.js"]);
    expect(lines.slice(lines.indexOf("   verid = node cli.js"))).toEqual([
      "   verid = node cli.js",
      "",
      "   🔪 verid cook --mode <prep|recipe|remix>",
      `      ${"w".repeat(50)}  developer · prep, recipe`,
      "   👅 verid taste",
      "      run the tests",
      "",
      "   footer",
    ]);
    expect(Math.max(...lines.map((line) => [...line].length))).toBeLessThanOrEqual(100);
  });
});

describe("pickLines and parsePick: a numbered list to pick several from", () => {
  it("numbers the options, marks the ticked ones ◉, then says how to answer", () => {
    expect(
      pickLines(
        "Where?",
        [{ label: "src/", hint: "new" }, { label: "packages/" }],
        [0],
        "Pick:",
        false,
      ),
    ).toEqual(["Where?", "    ◉ 1. src/       new", "    ◯ 2. packages/", "  Pick:"]);
  });

  it("reads numbers from the list and globs, comma-separated, each once", () => {
    const rows = ["src/**", "packages/**", "scripts/**"];
    expect({
      "1,3": parsePick("1,3", rows),
      "2, lib/**/*.ts": parsePick("2, lib/**/*.ts", rows),
      "1, 1, src/**": parsePick("1, 1, src/**", rows),
    }).toEqual({
      "1,3": { ok: true, globs: ["src/**", "scripts/**"] },
      "2, lib/**/*.ts": { ok: true, globs: ["packages/**", "lib/**/*.ts"] },
      "1, 1, src/**": { ok: true, globs: ["src/**"] },
    });
  });

  it("takes a bare folder name for everything in that folder, and a file name as it is", () => {
    expect({
      lib: parsePick("lib", []),
      "lib/": parsePick("lib/", []),
      "src\\core\\": parsePick("src\\core\\", []),
      "main.py": parsePick("main.py", []),
    }).toEqual({
      lib: { ok: true, globs: ["lib/**"] },
      "lib/": { ok: true, globs: ["lib/**"] },
      "src\\core\\": { ok: true, globs: ["src\\core/**"] },
      "main.py": { ok: true, globs: ["main.py"] },
    });
  });

  it("refuses a number that is not in the list, and an answer with nothing in it", () => {
    const rows = ["src/**"];
    expect({
      "2": parsePick("2", rows),
      "0": parsePick("0", rows),
      ",": parsePick(",", rows),
    }).toEqual({
      "2": { ok: false, part: "2" },
      "0": { ok: false, part: "0" },
      ",": { ok: false, part: "," },
    });
  });
});
