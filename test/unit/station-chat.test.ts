import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { expect, it } from "vitest";
import { tempProject } from "../support/project.js";
import { stationBoardChat, type Spawner } from "../../src/adapters/board-chat.js";
import { writeState, statePaths } from "../../src/adapters/state-store.js";

const t = tempProject("verid-station-chat-", {
  state: { schemaVersion: 1 },
  setup: (p) => {
    p.contextSetup("en", {
      providers: ["codex"],
      // The no-brain drive would launch the next station itself when one closes.
      drive: "big-brain",
      stations: 2,
      roles: { reviewer: ["verid_reviewer"] },
    });
  },
});

it("keeps one conversation per station and limits simultaneous processes", async () => {
  const roots = [t.newDir("chat-a-"), t.newDir("chat-b-"), t.newDir("chat-c-")];
  const state = t.loadState();
  for (const [i, root] of roots.entries()) {
    t.putAt(root, ".verid/manifest.yaml", t.manifestText());
    t.putAt(root, ".verid/.state/state.json", JSON.stringify(state));
    state.stations[`module-${i}`] = {
      module: `module-${i}`,
      path: root,
      branch: `feat/module-${i}`,
      main: "main",
      base: "b",
      common: "common",
      boundary: [`src/${i}/**`],
      sha256: "p",
      spec_sha256: "s",
      design_sha256: "d",
      at: "now",
      stage: "open",
    };
  }
  writeState(statePaths(t.dir), state);
  const children: (EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
  })[] = [];
  const calls: string[] = [];
  const spawn: Spawner = (_launch, cwd) => {
    calls.push(cwd);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    });
    children.push(child);
    return child as unknown as ChildProcess;
  };
  const chat = stationBoardChat(t.dir, spawn);
  try {
    await chat.send("module-0", { task: null, text: "first", provider: "codex" });
    await chat.send("module-1", { task: null, text: "second", provider: "codex" });
    expect(calls).toEqual(roots.slice(0, 2));
    await expect(
      chat.send("module-2", { task: null, text: "third", provider: "codex" }),
    ).rejects.toThrow();
    expect((await chat.status("module-0")).lines.some((line) => line.text === "second")).toBe(
      false,
    );
    children[0]!.emit("close", 0);
    expect((await chat.status("module-1")).running).toBe(true);
    await chat.send("module-2", { task: null, text: "third", provider: "codex" });
    await expect(
      chat.send("../escape", { task: null, text: "x", provider: "codex" }),
    ).rejects.toThrow();
  } finally {
    for (const child of children) child.emit("close", 0);
    chat.stopAll();
  }
});
