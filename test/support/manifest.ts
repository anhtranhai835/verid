import { stringify } from "yaml";
import { defaultRoles } from "../../src/core/manifest.js";
import { RUNNER, type Payload } from "./fixtures.js";
export const manifest = (
  sourceGlob = "src/**",
  testCmd = `"${process.execPath}" "${RUNNER}" {junit}`,
  repoPath = ".",
  mode = "remix",
  header: string[] = [],
  repoExtra: string[] = [],
) =>
  [
    "schemaVersion: 1",
    `mode: ${mode}`,
    ...header,
    "repos:",
    `  - path: ${repoPath}`,
    `    test_cmd: ${JSON.stringify(testCmd)}`,
    `    source_globs: ["${sourceGlob}"]`,
    '    test_globs: ["test/**"]',
    ...repoExtra,
    "",
  ].join("\n");

export const autoManifest = (testCmd?: string) =>
  manifest("src/**", testCmd, ".", "prep", [
    "drive: auto",
    "roles:",
    '  reviewer: ["verid:reviewer"]',
    '  tester: ["verid:tester"]',
    '  coder: ["verid:coder"]',
  ]);

const SRC_TEST = '    source_globs: ["src/**"]\n    test_globs: ["test/**"]';

export const architectureManifest = (
  check: Record<string, unknown> | null,
  mode = "remix",
  extra = 'roles:\n  reviewer: ["verid:reviewer"]\n',
  globs = SRC_TEST,
) =>
  manifest(
    "src/**",
    undefined,
    ".",
    mode,
    mode === "remix" ? [] : [extra.trimEnd()],
    check ? [`    architecture_check: ${JSON.stringify(check)}`] : [],
  ).replace(SRC_TEST, globs);

export function projectManifest(extra: Payload = {}, preset = "plain"): Payload {
  const repo: Payload = { path: ".", source_globs: ["src/**"], test_globs: ["test/**"] };
  if (preset === "review") repo.test_cmd = `"${process.execPath}" "${RUNNER}" {junit}`;
  const value: Payload = {
    schemaVersion: 1,
    mode: preset === "review" ? "recipe" : "remix",
  };
  if (preset === "review") value.drive = "human";
  if (preset === "codex")
    Object.assign(value, {
      providers: ["codex"],
      roles: {
        reviewer: ["reviewer", "verid_reviewer"],
        tester: ["verid:tester"],
        coder: ["verid:coder"],
      },
    });
  if (preset === "review")
    Object.assign(value, {
      providers: ["claude-code", "codex"],
      roles: {
        reviewer: ["verid:reviewer", "verid_reviewer"],
        security: ["verid:security", "codex_security"],
      },
    });
  return { ...value, repos: [repo], ...extra };
}

export const kanbanManifest = (): string =>
  stringify({
    schemaVersion: 1,
    workflow: "kanban",
    mode: "prep",
    providers: ["codex"],
    roles: defaultRoles(["codex"]),
    architecture: "none",
    repos: [
      {
        path: ".",
        source_globs: ["src/**"],
        test_globs: ["test/**"],
        test_cmd: `"${process.execPath}" "${RUNNER}" {junit}`,
      },
    ],
  });
