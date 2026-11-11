import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tempProject } from "../support/project.js";

let project: string;

const t = tempProject("verid-cli-messages-", {
  approved: true,
  cwd: () => project,
  bind: (p) => {
    project = p.root;
  },
});
const { cli, path, put } = t;

const uncooked = () => rmSync(path(".verid"), { recursive: true, force: true });

describe("a folder that was never cooked", () => {
  it("tells the developer to cook, without naming taste or two languages", async () => {
    uncooked();
    for (const args of [["menu"], ["order"], ["order", "calc"], ["menu", "--commits"]]) {
      const r = await cli(...args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.stderr, args.join(" ")).toContain("VERID_BURNT_MANIFEST_MISSING");
      expect(r.stderr, args.join(" ")).toMatch(/cook --mode <prep\|recipe\|remix>/);
      expect(r.stderr, args.join(" ")).not.toContain("taste");
      expect(r.stderr, args.join(" ")).not.toMatch(/^(vi|en): /m);
    }
  });

  it("keeps both languages for an error once a manifest exists but no language was chosen", async () => {
    put(".verid/.state/state.json", JSON.stringify({ schemaVersion: 1 }));
    const r = await cli("order", "no-such-module");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^vi: /m);
    expect(r.stderr).toMatch(/^en: /m);
  });
});

describe("the command table", () => {
  it("fits 100 columns when verid is called by a long command, naming it once", async () => {
    const r = await cli("help");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ *verid = node ".+"$/m);
    const table = r.stdout.split("\n").filter((line) => !line.includes(" = node "));
    expect(Math.max(...table.map((line) => [...line].length))).toBeLessThanOrEqual(100);
    expect(r.stdout).toContain("   🔪 verid cook");
    expect(r.stdout.match(/node "/g)).toHaveLength(1);
  });

  it("starts every row's description in lower case", async () => {
    const rows = (await cli("help")).stdout.match(/^ {6}\S.*$/gm) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(13);
    for (const row of rows) expect(row).toMatch(/^ {6}[a-z]/);
  });
});

describe("verid with no arguments", () => {
  it("shows the next step above the table in a cooked project, and help does not", async () => {
    const next = (await cli("menu")).stdout.trimEnd().split("\n").at(-1)!;
    const bare = (await cli()).stdout;
    expect(bare).toContain(next);
    expect(bare.indexOf(next)).toBeLessThan(bare.indexOf("verid cook"));
    expect((await cli("help")).stdout).not.toContain(next);
  });

  it("shows only the table before cook", async () => {
    uncooked();
    const r = await cli();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verid cook");
    expect(r.stdout).not.toContain("module calc");
  });

  it("still shows the table when the manifest cannot be read", async () => {
    put(".verid/manifest.yaml", "schemaVersion: 1\nmode: [unclosed\n");
    const r = await cli();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("verid cook");
  });
});
