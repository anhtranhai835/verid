import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage } from "../../src/adapters/i18n.js";
import { manifestUpgradeLines, planCook, setupDoneLine } from "../../src/cli/init.js";
import { setupPreview } from "../../src/core/setup-plan.js";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, lstatSync: vi.fn(fs.lstatSync) };
});

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "verid-instruction-setup-"));
  vi.stubEnv("CLAUDECODE", "");
  vi.stubEnv("CODEX_HOME", join(project, "codex home"));
  setLanguage("en");
});
afterEach(async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(lstatSync).mockReset().mockImplementation(fs.lstatSync);
  vi.unstubAllEnvs();
  setLanguage(null);
  rmSync(project, { recursive: true, force: true });
});

it("names a linked provider instruction file instead of blaming the manifest", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const rows = [
    { provider: "claude-code", file: "CLAUDE.md" },
    { provider: "codex", file: "AGENTS.md" },
  ];
  for (const row of rows) {
    const path = join(project, row.file);
    writeFileSync(path, "# Existing instructions\n");
    vi.mocked(lstatSync).mockImplementation(((target: string) => {
      const stat = fs.lstatSync(target);
      return target === path ? { ...stat, isSymbolicLink: () => true } : stat;
    }) as typeof lstatSync);
    await expect(
      planCook(project, { mode: "prep", providers: [row.provider], src: [], tests: [] }),
    ).rejects.toMatchObject({
      code: "VERID_BURNT_INSTRUCTIONS_LINKED",
      params: { path: row.file },
    });
  }
});

it("offers general-purpose only when the additional agent field is absent", () => {
  const manifest = { repos: [], roles: undefined };
  const rows = [
    { missing: ["allowed_agents"], lines: ['  + allowed_agents: ["general-purpose"]'] },
    { missing: [], lines: [] },
  ];
  for (const row of rows) expect(manifestUpgradeLines(manifest, row.missing)).toEqual(row.lines);
});

it("keeps intact CRLF instruction files byte-for-byte in cook and upgrade previews", async () => {
  const flags = {
    mode: "prep",
    layout: "monorepo",
    providers: ["claude-code", "codex"],
    src: [],
    tests: [],
  };
  const initial = await planCook(project, flags);
  expect(initial.apply().failed).toBe(false);
  const files = ["CLAUDE.md", "AGENTS.md"];
  const before = files.map((file) => {
    const path = join(project, file);
    const text = `user\r\n${readFileSync(path, "utf8").replaceAll("\n", "\r\n")}after\r\n`;
    writeFileSync(path, text);
    return readFileSync(path);
  });
  const rows = [{ upgrade: false }, { upgrade: true }];
  for (const row of rows) {
    const plan = await planCook(project, { ...flags, upgrade: row.upgrade }, row.upgrade);
    for (const [index, file] of files.entries()) {
      expect(plan.steps.find((step) => step.rel === file)).toEqual({ action: "kept", rel: file });
      expect(setupPreview(plan.files).find((line) => line.endsWith(file))).toContain(`= ${file}`);
      expect(readFileSync(join(project, file))).toEqual(before[index]);
    }
    expect(plan.apply().failed).toBe(false);
    for (const [index, file] of files.entries())
      expect(readFileSync(join(project, file))).toEqual(before[index]);
  }
});

it("lists the selected instruction files to commit and their per-machine workspace location", () => {
  const rows = [
    { providers: ["claude-code"], files: "CLAUDE.md" },
    { providers: ["codex"], files: "AGENTS.md" },
    { providers: ["claude-code", "codex"], files: "CLAUDE.md  AGENTS.md" },
  ] as const;
  for (const row of rows) {
    const done = setupDoneLine("monorepo", row.providers);
    expect(done.split("\n").find((line) => line.includes("Commit"))).toContain(row.files);
    const workspace = setupDoneLine("workspace", row.providers);
    expect(workspace).toContain(`${row.files} at the workspace root`);
    expect(workspace).toContain("per-machine");
    expect(workspace).toContain("cook regenerates");
  }
});
