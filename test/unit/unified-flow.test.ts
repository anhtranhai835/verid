import { developerProject } from "../support/cook.js";
import { existsSync, readFileSync, rmSync } from "node:fs";

import { join } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { parseManifest, renderManifest, defaultRoles } from "../../src/core/manifest.js";
import { planCook } from "../../src/cli/init.js";
import { moduleCommand } from "../../src/cli/module.js";
import { renderInstructions } from "../../src/core/instructions.js";

let project: string;
const repo = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };
developerProject("verid-unified-", {
  bind: (p) => {
    project = p.root;
  },
});

it("AC-1: legacy workflows load with either drive and do not restrict remix", () => {
  for (const workflow of [undefined, "classic", "modular", "kanban"])
    for (const drive of ["human", "auto"])
      expect(
        parseManifest({
          schemaVersion: 1,
          mode: "prep",
          workflow,
          drive,
          roles: defaultRoles(["codex"]),
          providers: ["codex"],
          repos: [repo],
        }).ok,
      ).toBe(true);
  expect(
    parseManifest({ schemaVersion: 1, mode: "remix", workflow: "modular", repos: [repo] }).ok,
  ).toBe(true);
});

it("AC-3: ai is the public drive name and auto remains a compatible alias", () => {
  const read = (drive: string) =>
    parseManifest({
      schemaVersion: 1,
      mode: "prep",
      drive,
      roles: defaultRoles(["codex"]),
      providers: ["codex"],
      repos: [repo],
    });
  expect(read("ai")).toEqual(read("auto"));
  expect(read("robot")).toMatchObject({ ok: false, detail: "drive: must be human or ai" });
  const written = parse(
    renderManifest("prep", repo, defaultRoles(["codex"]), "auto", "monorepo", undefined, ["codex"]),
  );
  expect(written.drive).toBe("ai");
  expect(written).not.toHaveProperty("workflow");
});

it("AC-2: legacy flags are accepted as aliases, with notes for retired choices", async () => {
  for (const workflow of ["classic", "kanban", "modular"]) {
    const plan = await planCook(project, { mode: "prep", workflow, src: [], tests: [] });
    if (workflow !== "modular") expect(plan.notes.join("\n")).toMatch(/ignored|bỏ qua/i);
  }
  await expect(
    planCook(project, { workflow: "unknown", src: [], tests: [] }),
  ).rejects.toMatchObject({ code: "VERID_BURNT_INIT_INVALID" });
});

it("AC-6, AC-7: prep and recipe always scaffold modules without a workflow choice", async () => {
  for (const mode of ["prep", "recipe"]) {
    const plan = await planCook(project, {
      mode,
      drive: "ai",
      providers: ["codex"],
      src: [],
      tests: [],
    });
    expect(plan.apply().failed).toBe(false);
    expect(existsSync(join(project, ".verid/templates/module/ba/requirements.md"))).toBe(true);
    expect(existsSync(join(project, ".verid/artifacts/03-modules/README.md"))).toBe(true);
    expect(parse(readFileSync(join(project, ".verid/manifest.yaml"), "utf8"))).toMatchObject({
      drive: "ai",
    });
    expect((await moduleCommand(project, "identity")).exit).toBe(0);
    expect(
      readFileSync(
        join(project, ".verid/artifacts/03-modules/identity/ba/requirements.md"),
        "utf8",
      ),
    ).toContain("identity");
    rmSync(join(project, ".verid"), { recursive: true, force: true });
  }
});

it("AC-11: remix keeps its baseline workflow without module scaffolding", async () => {
  (await planCook(project, { mode: "remix", src: [], tests: [] })).apply();
  expect(existsSync(join(project, ".verid/artifacts"))).toBe(false);
  await expect(moduleCommand(project, "identity")).rejects.toMatchObject({
    params: { detail: "verid module needs mode prep or recipe" },
  });
});

it("AC-13: generated instructions describe dossiers and board priorities, with drive-specific sessions", () => {
  for (const drive of ["human", "ai"]) {
    const parsed = parseManifest({
      schemaVersion: 1,
      mode: "prep",
      drive,
      providers: ["codex"],
      roles: defaultRoles(["codex"]),
      repos: [repo],
    });
    if (!parsed.ok) throw new Error(parsed.detail);
    const instructions = renderInstructions(parsed.manifest, "codex");
    expect(instructions).toContain("Artifacts: .verid/artifacts/03-modules/<name>");
    expect(instructions).toContain("verid board");
    if (drive === "human") expect(instructions).toContain("ONE TASK PER SESSION");
    else {
      expect(instructions).toContain("One session follows that queue");
      expect(instructions).not.toContain("ONE TASK PER SESSION");
    }
  }
});
