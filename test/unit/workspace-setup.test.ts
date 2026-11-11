import { developerProject } from "../support/cook.js";
import { mkdirSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { expect, it } from "vitest";
import { planCook } from "../../src/cli/init.js";
import { renderManifest } from "../../src/core/manifest.js";

let project: string;

developerProject("verid-workspace-plan-", {
  codexHome: false,
  claude: "unset",
  bind: (p) => {
    project = p.root;
  },
  setup: (p) => {
    mkdirSync(p.path(".verid"));
  },
});

it("changes the setup revision when a kept manifest changes clone inputs", async () => {
  const write = (remote: string, branch: string) =>
    writeFileSync(
      join(project, ".verid/manifest.yaml"),
      renderManifest(
        "prep",
        {
          path: "api",
          remote,
          default_branch: branch,
          source_globs: ["src/**"],
          test_globs: ["tests/**"],
        },
        undefined,
        "human",
        "workspace",
      ),
    );
  const flags = { src: [], tests: [] };
  write("../a.git", "main");
  const first = await planCook(project, flags);
  write("../b.git", "main");
  const second = await planCook(project, flags);
  write("../b.git", "develop");
  const third = await planCook(project, flags);
  expect(first.revision).not.toBe(second.revision);
  expect(second.revision).not.toBe(third.revision);
});
