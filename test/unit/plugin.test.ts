import { describe, expect, it } from "vitest";
import {
  pluginManifestSchema,
  pluginsSchema,
  pluginArgs,
  pluginSource,
  pluginVersionMatches,
} from "../../src/core/plugin.js";

const valid = { name: "sample-log", version: "1.0.0", veridApi: "1", description: "Log events" };

describe("plugin contracts", () => {
  it("accepts the supported manifest and supplies empty optional collections", () => {
    expect(pluginManifestSchema.parse(valid)).toMatchObject({
      ...valid,
      setup: [],
      hooks: {},
      skills: [],
      agents: [],
      config: {},
    });
  });
  it.each(["name", "version", "veridApi", "description"])("requires %s", (key) => {
    const input: Record<string, unknown> = { ...valid };
    delete input[key];
    expect(pluginManifestSchema.safeParse(input).success).toBe(false);
  });
  it.each(["BadName", "../escape", "a_b", "-bad", "con", "verid"])(
    "rejects unsafe plugin name %s",
    (name) => {
      expect(pluginManifestSchema.safeParse({ ...valid, name }).success).toBe(false);
    },
  );
  it("rejects unknown APIs, events and paths outside the package", () => {
    for (const change of [
      { veridApi: "2" },
      { hooks: { beforeWrite: "node x" } },
      { skills: ["../skill"] },
      { agents: ["/agent.md"] },
    ])
      expect(pluginManifestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
  it("requires a pinned commit for registered git sources and unique names", () => {
    const entry = {
      name: "sample-log",
      version: "1.0.0",
      source: "git:https://example.org/repo#main",
      enabled: true,
      config: {},
      integrity: "a".repeat(64),
      skills: [],
      agents: [],
      files: [],
    };
    expect(pluginsSchema.safeParse({ schemaVersion: 1, plugins: [entry] }).success).toBe(false);
    expect(
      pluginsSchema.safeParse({ schemaVersion: 1, plugins: [{ ...entry, commit: "b".repeat(40) }] })
        .success,
    ).toBe(true);
    expect(
      pluginsSchema.safeParse({
        schemaVersion: 1,
        plugins: [
          { ...entry, source: "file:./sample" },
          { ...entry, source: "file:./sample" },
        ],
      }).success,
    ).toBe(false);
  });
  it("splits quoted arguments without interpreting shell syntax or Windows escapes", () => {
    expect(pluginArgs('node "C:\\Program Files\\tool.mjs" "hello world" \'\'')).toEqual([
      "node",
      "C:\\Program Files\\tool.mjs",
      "hello world",
      "",
    ]);
    expect(pluginArgs("node tool.mjs ; echo danger")).toEqual([
      "node",
      "tool.mjs",
      ";",
      "echo",
      "danger",
    ]);
    expect(() => pluginArgs('node "unterminated')).toThrow();
  });
  it("limits sources to file directories and git URLs with explicit refs", () => {
    expect(pluginSource("file:../sample")).toEqual({ kind: "file", path: "../sample" });
    expect(pluginSource("git:https://example.org/repo#v1")).toEqual({
      kind: "git",
      url: "https://example.org/repo",
      ref: "v1",
    });
    for (const source of [
      "npm:sample",
      "git:https://example.org/repo",
      "git:--upload-pack=evil#main",
      "git:https://example.org/repo#--evil",
      "file:",
    ])
      expect(() => pluginSource(source)).toThrow();
  });
  it.each([
    ["v22.3.0", ">=22.0.0", true],
    ["v20.0.0", ">=22.0.0", false],
    ["1.3.0", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["0.2.5", "^0.2.0", true],
    ["0.3.0", "^0.2.0", false],
    ["0.0.2", "^0.0.1", false],
    ["1.2.5", "~1.2.0", true],
    ["1.3.0", "~1.2.0", false],
    ["1.2.0", "1.2.0", true],
    ["unversioned", "1.2.0", false],
  ])("checks prerequisite version %s against %s", (actual, required, matches) => {
    expect(pluginVersionMatches(actual, required)).toBe(matches);
  });
});
