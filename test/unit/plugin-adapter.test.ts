import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pluginCommand } from "../../src/cli/plugins.js";
import {
  installPlugin,
  emitPluginEvent,
  pluginIgnore,
  restorePlugins,
  checkPluginTools,
  removePlugin,
} from "../../src/adapters/plugins.js";
import { killTree } from "../../src/adapters/test-runner.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("../../src/adapters/test-runner.js", () => ({ killTree: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});
let project: string;
let source: string;
const result = (status = 0) =>
  ({ status, stdout: "", stderr: "", pid: 1, output: [null, "", ""], signal: null }) as ReturnType<
    typeof spawnSync
  >;
const scriptChild = () =>
  Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    kill: vi.fn(),
  }) as unknown as ReturnType<typeof spawn>;
beforeEach(async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(renameSync).mockImplementation(fs.renameSync);
  project = mkdtempSync(join(tmpdir(), "verid-plugin-unit-"));
  source = join(project, "fixture");
  mkdirSync(source);
  mkdirSync(join(project, ".verid/.state"), { recursive: true });
  writeFileSync(join(project, ".verid/.state/state.json"), '{"schemaVersion":1}');
  writeFileSync(
    join(source, "verid-plugin.json"),
    JSON.stringify({ name: "board", version: "1.0.0", events: { taste: "run.mjs" } }),
  );
  writeFileSync(join(source, "run.mjs"), "original");
  vi.mocked(spawnSync).mockReset().mockReturnValue(result());
  vi.mocked(killTree).mockReset();
  vi.mocked(spawn)
    .mockReset()
    .mockImplementation(() => {
      const child = scriptChild();
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(project, { recursive: true, force: true });
});

it("keeps the inspected staged copy inside protected plugins while waiting for confirmation", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const promise = installPlugin(project, `file:${source}`, { io: { input, output, color: false } });
  const protectedStage =
    existsSync(join(project, ".verid/plugins")) &&
    readdirSync(join(project, ".verid/plugins")).some((name) => name.startsWith(".fetch-"));
  writeFileSync(join(source, "run.mjs"), "changed during confirmation");
  input.write("yes\n");
  await promise;
  expect(protectedStage).toBe(true);
  expect(readFileSync(join(project, ".verid/plugins/board/run.mjs"), "utf8")).toBe("original");
});

it("never publishes an unconfirmed plugin and preserves existing ignore lines", async () => {
  const rows = [
    ["no\n", false],
    ["yes\n", true],
  ] as const;
  for (const [answer, accepted] of rows) {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => {
      text += chunk.toString();
    });
    const promise = installPlugin(project, `file:${source}`, {
      io: { input, output, color: false },
    });
    const settled = promise.then(
      () => "installed",
      (error: Error) => error.message,
    );
    input.write(answer);
    expect(await settled).toBe(accepted ? "installed" : "VERID_BURNT_PLUGIN_CONFIRM");
    expect(text).toContain("board 1.0.0");
    expect(text).toContain("taste");
    expect(existsSync(join(project, ".verid/plugins/board"))).toBe(accepted);
  }
  expect(pluginIgnore(".state/\n# custom\n")).toBe(".state/\n# custom\nplugins/\n");
});

it("clones only sanitized remotes with inherited stdio and the phase 3 protocol restriction", async () => {
  vi.mocked(spawnSync).mockReturnValue(result(1));
  vi.stubEnv("GIT_ALLOW_PROTOCOL", "ext:fd");
  const rows = [
    "git:https://user:password@example.com/board.git",
    "git:ssh://git@example.com/board.git",
  ];
  for (const sourceText of rows) {
    await expect(installPlugin(project, sourceText, { yes: true })).rejects.toThrow(
      "VERID_BURNT_PLUGIN_INVALID",
    );
    const [command, args, options] = vi.mocked(spawnSync).mock.lastCall!;
    expect(command).toBe("git");
    expect(args?.[0]).toBe("clone");
    expect(args?.join(" ")).not.toContain("password");
    expect(options?.stdio).toBe("inherit");
    expect(options?.timeout).toBeUndefined();
    expect(options?.env?.GIT_ALLOW_PROTOCOL).toBe("https:ssh:git:file");
  }
});

it("refuses hostile committed clone and npm sources before invoking any subprocess", async () => {
  const rows = [
    "git:-evil",
    "git:\\\\host\\share",
    "git://host/share#-evil",
    "git:file://host/x",
    "npm:--prefix=elsewhere",
    "npm:x@file:../elsewhere",
  ];
  for (const sourceText of rows)
    await expect(installPlugin(project, sourceText, { yes: true })).rejects.toThrow(
      "VERID_BURNT_PLUGIN_SOURCE",
    );
  expect(spawnSync).not.toHaveBeenCalled();
});

it("discards plugin output and sends JSON without inheriting Node injection variables", async () => {
  await installPlugin(project, `file:${source}`, { yes: true });
  vi.stubEnv("NODE_OPTIONS", "--require=untrusted.cjs");
  vi.stubEnv("NODE_PATH", "/untrusted");
  const child = scriptChild();
  let payload = "";
  child.stdin!.on("data", (chunk) => {
    payload += chunk.toString();
  });
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  });
  expect(await emitPluginEvent(project, "taste", { passed: false })).toEqual([]);
  const [command, args, options] = vi.mocked(spawn).mock.lastCall!;
  expect(command).toBe(process.execPath);
  expect(args).toEqual([join(project, ".verid/plugins/board/run.mjs")]);
  expect(options?.stdio).toEqual(["pipe", "ignore", "ignore"]);
  expect(options?.detached).toBe(process.platform !== "win32");
  expect(options?.env?.NODE_OPTIONS).toBeUndefined();
  expect(options?.env?.NODE_PATH).toBeUndefined();
  expect(JSON.parse(payload)).toEqual({ passed: false, event: "taste" });
});

it("kills the plugin process tree at its deadline and audits a timeout without changing the decision", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await installPlugin(project, `file:${source}`, { yes: true });
  const child = scriptChild();
  vi.mocked(spawn).mockReturnValue(child);
  const pending = emitPluginEvent(project, "taste", { passed: false }, Date.now() + 1000);
  await vi.advanceTimersByTimeAsync(1000);
  const warnings = await pending;
  expect(killTree).toHaveBeenCalledWith(12345);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("VERID_BURNT_PLUGIN_EVENT");
  expect(readFileSync(join(project, ".verid/.state/audit.jsonl"), "utf8")).toContain(
    '"reason":"timeout"',
  );
});

it("recognises an existing plugins ignore entry on any line without duplicating it", () => {
  const rows = [
    ["plugins/\n# later\n.state/\n", "plugins/\n# later\n.state/\n"],
    [".state/\n/plugins/\ncustom/\n", ".state/\n/plugins/\ncustom/\n"],
    ["plugins/\r\ncustom/\r\n", "plugins/\r\ncustom/\r\n"],
    [".state/\nplugins/", ".state/\nplugins/"],
    ["# plugins/\n", "# plugins/\nplugins/\n"],
  ] as const;
  for (const [text, expected] of rows) expect.soft(pluginIgnore(text)).toBe(expected);
});

it("fetches npm specs without lifecycle scripts or a shell and restores their recorded version", async () => {
  const specs: string[] = [];
  vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
    const work = String(args?.[(args?.indexOf("--prefix") ?? -1) + 1]);
    const folder = join(work, "node_modules/@team/board");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "package.json"), '{"name":"@team/board","version":"1.0.0"}');
    writeFileSync(
      join(folder, "verid-plugin.json"),
      '{"name":"board","version":"1.0.0","events":{"taste":"run.mjs"}}',
    );
    writeFileSync(join(folder, "run.mjs"), "original");
    specs.push(String(args?.at(-1)));
    return result();
  });
  await installPlugin(project, "npm:@team/board@^1.0.0", { yes: true });
  const first = vi.mocked(spawnSync).mock.calls[0]!;
  expect(first[0]).toBe(process.execPath);
  expect(first[1]).toContain("--ignore-scripts");
  expect(first[1]).toContain("--no-bin-links");
  expect(first[2]?.stdio).toBe("inherit");
  expect(first[2]?.shell).toBeUndefined();
  rmSync(join(project, ".verid/plugins/board"), { recursive: true, force: true });
  expect(await restorePlugins(project, { yes: true })).toEqual([]);
  expect(specs).toEqual(["@team/board@^1.0.0", "@team/board@1.0.0"]);
});

it("checks required commands on PATH rather than treating the running Node binary as PATH evidence", () => {
  vi.stubEnv("PATH", "");
  expect(() =>
    checkPluginTools({ name: "board", version: "1.0.0", events: {}, requires: ["node"] }),
  ).toThrow("VERID_BURNT_PLUGIN_REQUIRES");
  expect(spawnSync).not.toHaveBeenCalled();
});

it("removes its unpublished code when writing plugins.json fails", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (String(to) === join(project, ".verid/plugins.json"))
      throw new Error("fixture disk failure");
    fs.renameSync(from, to);
  });
  await expect(installPlugin(project, `file:${source}`, { yes: true })).rejects.toThrow(
    "fixture disk failure",
  );
  expect(existsSync(join(project, ".verid/plugins.json"))).toBe(false);
  expect(existsSync(join(project, ".verid/plugins/board"))).toBe(false);
});

it("does not approve changed installed code when another plugin is added or removed", async () => {
  await installPlugin(project, `file:${source}`, { yes: true });
  writeFileSync(join(project, ".verid/plugins/board/run.mjs"), "changed");
  writeFileSync(
    join(source, "verid-plugin.json"),
    JSON.stringify({ name: "other", version: "1.0.0", events: { taste: "run.mjs" } }),
  );
  await installPlugin(project, `file:${source}`, { yes: true });
  const first = await emitPluginEvent(project, "taste", {});
  expect(first.join("\n")).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  expect(spawn).toHaveBeenCalledTimes(1);
  removePlugin(project, "other");
  vi.mocked(spawn).mockClear();
  expect((await emitPluginEvent(project, "taste", {})).join("\n")).toContain(
    "VERID_BURNT_PLUGIN_INTEGRITY",
  );
  expect(spawn).not.toHaveBeenCalled();
});

it("refuses plugin integrity changes without launching a script or silently approving it", async () => {
  const rows = [
    "script",
    "dependency",
    "new file",
    "removed file",
    "renamed file",
    "registry",
    "empty registry",
    "invalid registry",
    "missing registry",
    "missing record",
    "invalid record",
  ] as const;
  mkdirSync(join(source, "nested"));
  writeFileSync(join(source, "nested/helper.json"), "data");
  for (const change of rows) {
    const rowProject = join(project, change);
    mkdirSync(join(rowProject, ".verid/.state"), { recursive: true });
    writeFileSync(join(rowProject, ".verid/.state/state.json"), '{"schemaVersion":1}');
    await installPlugin(rowProject, `file:${source}`, { yes: true });
    const installed = join(rowProject, ".verid/plugins/board");
    const record = join(rowProject, ".verid/.state/plugin-integrity.json");
    switch (change) {
      case "script":
        writeFileSync(join(installed, "run.mjs"), "changed");
        break;
      case "dependency":
        writeFileSync(join(installed, "nested/helper.json"), "changed");
        break;
      case "new file":
        writeFileSync(join(installed, "extra.json"), "data");
        break;
      case "removed file":
        rmSync(join(installed, "nested/helper.json"));
        break;
      case "renamed file":
        renameSync(join(installed, "nested/helper.json"), join(installed, "nested/moved.json"));
        break;
      case "registry":
        writeFileSync(
          join(rowProject, ".verid/plugins.json"),
          readFileSync(join(rowProject, ".verid/plugins.json"), "utf8") + "\n",
        );
        break;
      case "empty registry":
        writeFileSync(join(rowProject, ".verid/plugins.json"), "[]");
        break;
      case "invalid registry":
        writeFileSync(join(rowProject, ".verid/plugins.json"), "broken");
        break;
      case "missing registry":
        rmSync(join(rowProject, ".verid/plugins.json"));
        break;
      case "missing record":
        rmSync(record, { force: true });
        break;
      case "invalid record":
        writeFileSync(record, "broken");
        break;
    }
    const warnings = await emitPluginEvent(rowProject, "taste", {});
    expect.soft(warnings.join("\n"), change).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
    expect.soft(warnings.join("\n"), change).toContain("verid plugin add");
    expect.soft(spawn, change).not.toHaveBeenCalled();
    expect
      .soft(readFileSync(join(rowProject, ".verid/.state/audit.jsonl"), "utf8"), change)
      .toContain('"reason":"integrity"');
    vi.stubEnv("CLAUDECODE", "");
    const doctor = await pluginCommand(rowProject, ["doctor"]);
    expect.soft(doctor.exit, change).toBe(1);
    expect.soft(doctor.stderr, change).toContain("VERID_BURNT_PLUGIN_INTEGRITY");
  }
});

it("restores changed code only after consent and refreshes its approval", async () => {
  await installPlugin(project, `file:${source}`, { yes: true });
  writeFileSync(join(project, ".verid/plugins/board/run.mjs"), "changed");
  const refused = await restorePlugins(project, {});
  expect(refused.join("\n")).toContain("VERID_BURNT_PLUGIN_CONFIRM");
  expect(readFileSync(join(project, ".verid/plugins/board/run.mjs"), "utf8")).toBe("changed");
  expect(await restorePlugins(project, { yes: true })).toEqual([]);
  expect(readFileSync(join(project, ".verid/plugins/board/run.mjs"), "utf8")).toBe("original");
  expect(await emitPluginEvent(project, "taste", {})).toEqual([]);
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("rebases local git sources from the invoking directory before cloning, while keeping URLs intact", async () => {
  vi.stubEnv("CLAUDECODE", "");
  vi.mocked(spawnSync).mockReturnValue(result(1));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(join(project, "nested"));
  const rows = [
    ["git:./board.git#v1", "nested/board.git"],
    ["git:https://example.com/board.git#v1", "https://example.com/board.git"],
  ];
  try {
    for (const [sourceText, remote] of rows) {
      await expect(pluginCommand(project, ["add", sourceText!, "--yes"])).rejects.toThrow(
        "VERID_BURNT_PLUGIN_INVALID",
      );
      expect(vi.mocked(spawnSync).mock.lastCall?.[1]?.[3]).toBe(remote);
    }
  } finally {
    cwd.mockRestore();
  }
});
