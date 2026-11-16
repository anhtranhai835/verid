import { tempProject, TEST_ROOT as root, type GitResult } from "../support/project.js";

import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The sample project of README.md's Quick start: this test keeps it working with today's verid.
const t = tempProject("verid-example-", {
  claudeProject: false,
  // Nothing from this machine: no Claude Code or Codex install, no home folder.
  env: () => ({
    CLAUDE_CONFIG_DIR: t.path("../claude-config"),
    CODEX_HOME: t.path("../codex"),
    HOME: t.path("../home"),
    USERPROFILE: t.path("../home"),
  }),
  subdir: "slugify",
});
const git = t.gitChecked((r: GitResult) => expect(r.status, r.stderr).toBe(0));

// The verid plugin as Claude Code records it once installed: an agent file for each mapped role.
function installVeridPlugin(): void {
  const config = t.path("../claude-config");
  const installPath = join(config, "cache", "verid");
  for (const agent of ["reviewer", "tester", "coder", "architect", "planner", "qa", "security"])
    t.putFile(join(installPath, "agents", `${agent}.md`), `---\nname: ${agent}\n---\n`);
  t.putFile(
    join(config, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "verid@verid": [{ scope: "user", installPath }] } }),
  );
}

describe("examples/slugify", () => {
  it("cooks with the vitest runner and passes doctor", async () => {
    cpSync(join(root, "examples", "slugify"), t.dir, { recursive: true });
    mkdirSync(t.path("../home"), { recursive: true });
    installVeridPlugin();

    const cook = await t.shortCliArgs([
      "cook",
      "--mode",
      "prep",
      "--provider",
      "claude-code",
      "--yes",
      "--lang",
      "en",
    ]);
    expect(cook.code, cook.err).toBe(0);
    expect(cook.out).toMatch(/Test runner:.*vitest/);

    git("init", "-q", "-b", "main");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "--no-verify", "-qm", "sample");

    const doctor = await t.shortCliArgs(["doctor"]);
    expect(doctor.code, doctor.out + doctor.err).toBe(0);
    expect(doctor.out).toContain("= Repo .: vitest");
  });
});
