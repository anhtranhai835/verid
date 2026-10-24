import { describe, expect, it } from "vitest";
import { parsePluginManifest, parsePluginSource, parsePluginList } from "../../src/core/plugins.js";

describe("workflow plugins", () => {
  it("validates a small manifest and refuses unknown fields, events and unsafe scripts", () => {
    const rows = [
      [
        {
          name: "board",
          version: "1.2.3",
          events: { taste: "hooks/taste.mjs" },
          requires: ["node", "git"],
        },
        true,
      ],
      [{ name: "board", version: "1.0.0", events: {} }, true],
      [{ name: "../board", version: "1.0.0", events: {} }, false],
      [{ name: "con", version: "1.0.0", events: {} }, false],
      [{ name: "Board", version: "1.0.0", events: {} }, false],
      [{ name: "board", version: "latest", events: {} }, false],
      [{ name: "board", version: "1.0.0", events: { unknown: "x.mjs" } }, false],
      [{ name: "board", version: "1.0.0", events: { taste: "../x.mjs" } }, false],
      [{ name: "board", version: "1.0.0", events: { taste: "hooks/../x.mjs" } }, false],
      [{ name: "board", version: "1.0.0", events: { taste: "C:\\x.mjs" } }, false],
      [{ name: "board", version: "1.0.0", events: { taste: "/x.mjs" } }, false],
      [{ name: "board", version: "1.0.0", events: { taste: "\\\\host\\x.mjs" } }, false],
      [{ name: "board", version: "1.0.0", events: { taste: "x.mjs:stream" } }, false],
      [{ name: "board", version: "1.0.0", events: { taste: "hooks./x.mjs" } }, false],
      [{ name: "board", version: "1.0.0", events: {}, requires: ["node -e evil"] }, false],
      [{ name: "board", version: "1.0.0", events: {}, setup: ["evil"] }, false],
    ] as const;
    for (const [input, ok] of rows) {
      const result = parsePluginManifest(input);
      expect(result.ok, JSON.stringify(input)).toBe(ok);
      if (!result.ok) expect(result.code).toBe("VERID_BURNT_PLUGIN_INVALID");
    }
    expect(parsePluginManifest({ name: "board", version: "1.0.0", events: {} })).toEqual({
      ok: true,
      manifest: { name: "board", version: "1.0.0", events: {}, requires: [] },
    });
  });

  it("parses local, git and npm sources without accepting clone options or network file shares", () => {
    const rows = [
      ["../board", { kind: "file", path: "../board" }],
      ["file:C:\\plugins\\board", { kind: "file", path: "C:\\plugins\\board" }],
      ["C:\\plugins\\board", { kind: "file", path: "C:\\plugins\\board" }],
      ["git:../board.git#v1", { kind: "git", remote: "../board.git", ref: "v1" }],
      [
        "https://example.com/board.git#main",
        { kind: "git", remote: "https://example.com/board.git", ref: "main" },
      ],
      ["git@github.com:team/board.git", { kind: "git", remote: "git@github.com:team/board.git" }],
      ["npm:@team/board@^1.0.0", { kind: "npm", spec: "@team/board@^1.0.0" }],
      ["board@1.0.0", { kind: "npm", spec: "board@1.0.0" }],
      ["git:--upload-pack=evil", null],
      ["-evil", null],
      ["git:\\\\host\\share", null],
      ["git://host/share", { kind: "git", remote: "git://host/share" }],
      ["git:file://host/share", null],
      ["git:file:////host/share", null],
      ["//host/share", null],
      ["file://host/share", null],
      ["git:https://example.com/x#-evil", null],
      ["git:ext::evil", null],
      ["npm:--prefix=evil", null],
      ["npm:x@https://example.com/x.tgz", null],
      ["npm:x;evil", null],
      ["", null],
    ] as const;
    for (const [input, expected] of rows) {
      const result = parsePluginSource(input);
      expect(result.ok ? result.source : null, input).toEqual(expected);
      if (!result.ok) expect(result.code).toBe("VERID_BURNT_PLUGIN_SOURCE");
    }
  });

  it("validates committed plugin entries before their sources or names reach I/O", () => {
    const rows = [
      [[], true],
      [[{ name: "board", source: "file:../board", resolved: "1.0.0" }], true],
      [[{ name: "../board", source: "file:../board", resolved: "1.0.0" }], false],
      [[{ name: "board", source: "git:--evil", resolved: "1.0.0" }], false],
      [[{ name: "board", source: "git:file://host/x", resolved: "a".repeat(40) }], false],
      [[{ name: "board", source: "npm:--evil", resolved: "1.0.0" }], false],
      [[{ name: "board", source: "git:../x.git", resolved: "--evil" }], false],
      [[{ name: "board", source: "file:../board", resolved: "1.0.0", enabled: true }], false],
      [
        [
          { name: "board", source: "file:../board", resolved: "1.0.0" },
          { name: "board", source: "file:../board", resolved: "1.0.0" },
        ],
        false,
      ],
    ] as const;
    for (const [input, ok] of rows)
      expect(parsePluginList(input).ok, JSON.stringify(input)).toBe(ok);
  });
});
