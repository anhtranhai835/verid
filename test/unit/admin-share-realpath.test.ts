import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePath, writtenPath } from "../../src/adapters/claude-code.js";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    realpathSync: Object.assign(vi.fn(fs.realpathSync), {
      native: vi.fn(fs.realpathSync.native),
    }),
  };
});

afterEach(() => vi.mocked(realpathSync.native).mockReset());

describe.skipIf(process.platform !== "win32")("administrative share realpaths", () => {
  it("maps administrative shares returned by realpath to the protected drive paths", () => {
    const rows = [
      [
        "Q:\\repo\\.verid\\.state\\state.json",
        "\\\\localhost\\C$\\repo\\.verid\\.state\\state.json",
        "c:\\repo\\.verid\\.state\\state.json",
      ],
      [
        "Q:\\repo\\.verid\\manifest.yaml",
        "\\\\localhost\\C$\\repo\\.verid\\manifest.yaml",
        "c:\\repo\\.verid\\manifest.yaml",
      ],
      [
        "Q:\\config\\settings.json",
        "\\\\?\\UNC\\AnyHost\\D$\\config\\settings.json",
        "d:\\config\\settings.json",
      ],
      [
        "Q:\\config\\projects\\session.jsonl",
        "\\\\.\\uNc\\AnyHost\\c$\\config\\projects\\session.jsonl",
        "c:\\config\\projects\\session.jsonl",
      ],
    ] as const;
    for (const [path, real, expected] of rows) {
      vi.mocked(realpathSync.native).mockReturnValue(real);
      expect.soft(normalizePath(path), path).toBe(expected);
    }
  });

  it("maps the realpath of an existing parent for a new protected target", () => {
    const rows = [
      [
        "Q:\\config\\agents\\new.md",
        "Q:\\config",
        "\\\\localhost\\C$\\config",
        "c:\\config\\agents\\new.md",
      ],
      [
        "Q:\\repo\\.verid\\manifest.yaml",
        "Q:\\repo\\.verid",
        "\\\\AnyHost\\D$\\repo\\.verid",
        "d:\\repo\\.verid\\manifest.yaml",
      ],
    ] as const;
    for (const [path, parent, real, expected] of rows) {
      vi.mocked(realpathSync.native).mockImplementation((target) => {
        if (target === parent) return real;
        throw new Error("ENOENT");
      });
      expect.soft(normalizePath(path), path).toBe(expected);
    }
  });

  it("maps administrative share prefixes exposed by resolving the written path", () => {
    const rows = [
      [
        "\\\\.\\UNC\\localhost\\ignored\\..\\C$\\repo\\.verid\\manifest.yaml",
        "c:\\repo\\.verid\\manifest.yaml",
      ],
      [
        "\\\\?\\UNC\\AnyHost\\ignored\\..\\d$\\config\\agents\\new.md",
        "d:\\config\\agents\\new.md",
      ],
    ] as const;
    for (const [path, expected] of rows) expect.soft(writtenPath(path), path).toBe(expected);
  });
});
