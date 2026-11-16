import { tempProject, CLI, TEST_ROOT as root } from "../support/project.js";
import { manifest } from "../support/project.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { expect, it } from "vitest";
import { developerEnv } from "./helpers.js";

const VITEST = join(root, "node_modules", "vitest", "vitest.mjs");

let project: string;
tempProject("verid-vitest-", {
  canonical: true,
  state: '{"schemaVersion":1}',
  manifest: () =>
    manifest(
      "src/**",
      '"' +
        process.execPath +
        '" "' +
        VITEST +
        '" run --globals --reporter=junit --outputFile={junit}',
    ),
  bind: (p) => {
    project = p.root;
  },
  setup: (p) => {
    mkdirSync(p.path("src"));
    mkdirSync(p.path("test"));
  },
});

function verid(...args: string[]) {
  const env = developerEnv("VITEST");
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

it("moves the cycle on a real vitest run: a stub for the missing module, COOKING on its assertion, then PLATED", () => {
  // remix: a test already fails, and the developer records it before the agent starts.
  writeFileSync(
    join(project, "test", "legacy.test.js"),
    'it("was broken before verid", () => expect(1).toBe(2));\n',
  );
  const baseline = verid("stock");
  expect(baseline.code).toBe(0);
  expect(baseline.out).toContain("legacy.test.js");

  writeFileSync(
    join(project, "test", "add.test.js"),
    'import { add } from "../src/add.js";\nit("adds", () => expect(add(2, 3)).toBe(5));\n',
  );
  // A test that cannot load is not RED yet: the stub step opens.
  const missing = verid("taste");
  expect(missing.out).toContain("verid: RAW → RAW · stub");
  expect(missing.code).toBe(1);

  writeFileSync(join(project, "src", "add.js"), "export const add = () => 0;\n"); // the stub
  const red = verid("taste");
  expect(red.out).toContain("verid: RAW · stub → COOKING");
  expect(red.code).toBe(1);

  writeFileSync(join(project, "src", "add.js"), "export const add = (a, b) => a + b;\n");
  const green = verid("taste");
  expect(green.out).toContain("verid: COOKING → PLATED");
  expect(green.code).toBe(0);
  const state = JSON.parse(readFileSync(join(project, ".verid", ".state", "state.json"), "utf8"));
  // The legacy test still fails, and is still not the agent's to fix.
  expect(state.tdd).toMatchObject({ state: "PLATED", failing: [] });
  expect(state.baseline).toHaveLength(1);
}, 60_000); // four real vitest runs: slow on a busy machine

it("finds vitest in package.json and runs it through npx, with no test_cmd in the manifest", () => {
  writeFileSync(
    join(project, ".verid", "manifest.yaml"),
    [
      "schemaVersion: 1",
      "mode: prep",
      "repos:",
      "  - path: .",
      '    source_globs: ["src/**"]',
      '    test_globs: ["test/**"]',
      "",
    ].join("\n"),
  );
  writeFileSync(join(project, "package.json"), '{"devDependencies":{"vitest":"*"}}');
  // The project's own install, as `npm install` would leave it: verid's vitest, offline.
  symlinkSync(join(root, "node_modules"), join(project, "node_modules"), "junction");
  writeFileSync(
    join(project, "test", "add.test.js"),
    'import { expect, it } from "vitest";\nimport { add } from "../src/add.js";\nit("adds", () => expect(add(2, 3)).toBe(5));\n',
  );
  writeFileSync(join(project, "src", "add.js"), "export const add = () => 0;\n");
  const red = verid("taste");
  expect(red.out).toContain("verid: RAW → COOKING");
  expect(red.code).toBe(1);
  const state = JSON.parse(readFileSync(join(project, ".verid", ".state", "state.json"), "utf8"));
  expect(state.runners).toEqual(["vitest@."]);
}, 60_000);
