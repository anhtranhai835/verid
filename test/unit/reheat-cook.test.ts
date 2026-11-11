import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { initCommand } from "../../src/cli/init.js";
import { interactiveCook } from "../../src/cli/cook-screen.js";
import { parseManifest } from "../../src/core/manifest.js";
import { developerProject } from "../support/cook.js";
import { ENTER, scriptedTerminal } from "../support/terminal.js";

let project: string;
const t = developerProject("verid-reheat-cook-", {
  cwd: () => project,
  codexHome: "codex home",
  claude: "unset",
  language: null,
  bind: (p) => {
    project = p.root;
  },
});
const { put, manifestText: manifest } = t;
const flags = { src: [], tests: [], mode: "reheat", yes: true, lang: "en" };

describe("cook in mode reheat", () => {
  it("writes the new system's repo beside a read-only legacy repo and makes the new folder", async () => {
    put("legacy/readme.txt", "old system");
    const result = await initCommand(project, { ...flags, legacy: "legacy" });
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain("reheat inventory");
    const text = manifest();
    expect(text).toContain('mode: "reheat" # prep | recipe | remix | reheat');
    const written = parse(text);
    expect(written.repos[0]).toMatchObject({ path: "app" });
    expect(written.repos[1]).toMatchObject({ path: "legacy", role: "legacy", read_only: true });
    expect(parseManifest(written)).toMatchObject({ ok: true });
    expect(existsSync(join(project, "app"))).toBe(true);
    expect(existsSync(join(project, "legacy", "readme.txt"))).toBe(true);
  });

  it("puts the new system in the folder --target names", async () => {
    put("legacy/readme.txt", "old system");
    const result = await initCommand(project, { ...flags, legacy: "legacy", target: "web/next" });
    expect(result.exit).toBe(0);
    const written = parse(manifest());
    expect(written.repos[0]).toMatchObject({ path: "web/next" });
    expect(written.repos[1]).toMatchObject({ path: "legacy", role: "legacy" });
    expect(existsSync(join(project, "web", "next"))).toBe(true);
    expect(existsSync(join(project, "app"))).toBe(false);
  });

  it("refuses a --target outside the project, inside or around the legacy folder, or outside reheat", async () => {
    put("legacy/readme.txt", "old system");
    for (const target of ["../elsewhere", "legacy", "legacy/new", ".", "/abs"])
      await expect(
        initCommand(project, { ...flags, legacy: "legacy", target }),
      ).rejects.toMatchObject({ code: "VERID_BURNT_INIT_INVALID", params: { path: "--target" } });
    await expect(
      initCommand(project, { ...flags, mode: "prep", target: "app" }),
    ).rejects.toMatchObject({ code: "VERID_BURNT_INIT_INVALID", params: { path: "--target" } });
    expect(existsSync(join(project, ".verid"))).toBe(false);
  });

  it("refuses a reheat manifest with no legacy folder, or one that is not a folder, before writing", async () => {
    put("legacy/readme.txt", "old system");
    await expect(initCommand(project, flags)).rejects.toMatchObject({
      code: "VERID_BURNT_INIT_INVALID",
      params: { path: "--legacy" },
    });
    await expect(initCommand(project, { ...flags, legacy: "missing" })).rejects.toMatchObject({
      code: "VERID_BURNT_INIT_INVALID",
      params: { path: "--legacy" },
    });
    await expect(
      initCommand(project, { ...flags, legacy: "legacy/readme.txt" }),
    ).rejects.toMatchObject({
      code: "VERID_BURNT_INIT_INVALID",
    });
    expect(existsSync(join(project, ".verid"))).toBe(false);
    expect(existsSync(join(project, "app"))).toBe(false);
  });

  it("asks for the legacy folder in the terminal when the mode is picked, and asks again for a wrong one", async () => {
    put("legacy/readme.txt", "old system");
    const terminal = scriptedTerminal([
      ENTER,
      "4" + ENTER,
      "nope\n",
      "legacy\n",
      ENTER,
      ENTER,
      ENTER,
      ENTER,
    ]);
    expect((await interactiveCook(project, terminal.io, "en-US")).exit).toBe(0);
    expect(terminal.screen()).toContain("reheat");
    expect(terminal.screen()).toContain("Folder of the legacy system");
    expect(terminal.screen()).toContain("nope is not a folder of this project");
    expect(parse(manifest())).toMatchObject({
      mode: "reheat",
      repos: [{ path: "app" }, { path: "legacy", role: "legacy", read_only: true }],
    });
    expect(existsSync(join(project, "app"))).toBe(true);
  });
});
