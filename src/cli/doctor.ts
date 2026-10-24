import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { node22OrLater } from "../core/doctor.js";
import { hasCurrentVeridHooks } from "../adapters/claude-settings.js";
import { bilingual, inLanguage, t } from "../adapters/i18n.js";
import { gitView } from "../adapters/git.js";
import { isDirectory, loadManifest } from "../adapters/manifest.js";
import { errno, VeridError } from "../adapters/state-store.js";
import { findRunners } from "../adapters/test-runner.js";
import { repoFolder } from "../adapters/workspace.js";
import type { Manifest } from "../core/manifest.js";
import type { MessageKey } from "../core/errors.js";
import type { CliResult } from "./test.js";

/** Read-only checks: never run a test, repair settings, or write the manifest cache. */
export async function doctorCommand(project: string): Promise<CliResult> {
  const say = (key: MessageKey, params: Record<string, string> = {}) => bilingual(key, params);
  const lines = [say("doctor.header", { project })];
  let problems = 0;
  const problem = (
    key: string,
    detail: MessageKey,
    fix: MessageKey,
    params: Record<string, string> = {},
  ) => {
    problems++;
    lines.push(
      inLanguage((lang) =>
        t(lang, "doctor.problem", {
          key,
          detail: t(lang, detail, params).replace(/[\r\n]+/g, " "),
          fix: t(lang, fix, params),
        }),
      ),
    );
  };
  if (!node22OrLater(process.version))
    problem("node", "doctor.node.old", "doctor.node.fix", { version: process.version });
  else lines.push(say("doctor.node.ok", { version: process.version }));

  const settingsFile = join(project, ".claude/settings.local.json");
  const hook = fileURLToPath(new URL("./hook.js", import.meta.url));
  let currentHooks = false;
  try {
    currentHooks = hasCurrentVeridHooks(JSON.parse(readFileSync(settingsFile, "utf8")), hook);
  } catch {
    // Missing, unreadable or malformed settings need the developer's attention.
  }
  if (!currentHooks) problem("hooks", "doctor.hooks.missing", "doctor.hooks.fix");
  else lines.push(say("doctor.hooks.ok"));

  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const recordFile = join(config, "plugins/installed_plugins.json");
  let installed: Record<string, unknown> = {};
  try {
    const record: unknown = JSON.parse(readFileSync(recordFile, "utf8"));
    if (!isObject(record) || record.version !== 2 || !isObject(record.plugins))
      problem("plugins.record", "doctor.plugins.unsupported", "doctor.plugins.repair", {
        file: recordFile,
      });
    else installed = record.plugins;
  } catch (e) {
    if (errno(e) !== "ENOENT" && !(e instanceof SyntaxError))
      problem("plugins.record", "doctor.plugins.unreadable", "doctor.plugins.permissions", {
        file: recordFile,
      });
    else if (e instanceof SyntaxError)
      problem("plugins.record", "doctor.plugins.invalid", "doctor.plugins.reinstall", {
        file: recordFile,
      });
  }
  for (const [name, marketplace, source] of [
    ["superpowers", "superpowers-marketplace", "obra/superpowers-marketplace"],
    ["andrej-karpathy-skills", "karpathy-skills", "forrestchang/andrej-karpathy-skills"],
    ["verid", "verid", "anhtranhai835/verid"],
  ] as const) {
    const found = Object.entries(installed).some(
      ([key, entries]) =>
        key.startsWith(`${name}@`) &&
        Array.isArray(entries) &&
        entries.some(
          (entry: unknown) =>
            isObject(entry) &&
            typeof entry.installPath === "string" &&
            isDirectory(entry.installPath) &&
            (entry.scope === "user" ||
              (["project", "local"].includes(String(entry.scope)) &&
                typeof entry.projectPath === "string" &&
                resolve(entry.projectPath) === resolve(project))),
        ),
    );
    if (!found)
      problem(`plugin.${name}`, "doctor.plugin.missing", "doctor.plugin.fix", {
        name,
        source,
        marketplace,
      });
    else lines.push(say("doctor.plugin.ok", { name }));
  }

  let manifest: Manifest | null = null;
  try {
    manifest = await loadManifest(project, { readOnly: true, checkPaths: false });
    if (!manifest) problem("manifest", "doctor.manifest.missing", "doctor.manifest.cook");
  } catch (e) {
    if (!(e instanceof VeridError) && !["EACCES", "EPERM"].includes(errno(e) ?? "")) throw e;
    problem(
      "manifest",
      e instanceof VeridError ? "doctor.manifest.invalid" : "doctor.manifest.unreadable",
      "doctor.manifest.fix",
      { detail: e instanceof VeridError ? (e.params.detail ?? e.code) : "" },
    );
  }
  for (const repo of [
    ...(manifest?.repos ?? []),
    ...(manifest?.layout === "workspace"
      ? [{ path: ".verid", source_globs: [], test_globs: [] }]
      : []),
  ]) {
    let folder: string;
    try {
      folder =
        manifest?.layout === "workspace"
          ? repoFolder(project, repo.path)
          : resolve(project, ...repo.path.split(/[/\\]/));
    } catch (error) {
      if (!(error instanceof VeridError)) throw error;
      problem("repo.folder", "doctor.manifest.invalid", "doctor.manifest.fix", {
        detail: error.params.detail ?? repo.path,
      });
      continue;
    }
    if (!isDirectory(folder)) {
      problem("repo.folder", "doctor.repo.folder.missing", "doctor.repo.folder.fix", {
        repo: repo.path,
      });
      continue;
    }
    lines.push(say("doctor.repo.folder.ok", { repo: repo.path }));
    const git = gitView(folder);
    if (!git)
      problem("repo.git", "doctor.repo.git.missing", "doctor.repo.git.fix", { repo: repo.path });
    else {
      if (!git.clean)
        problem("repo.dirty", "doctor.repo.dirty", "doctor.repo.dirty.fix", { repo: repo.path });
      else lines.push(say("doctor.repo.clean", { repo: repo.path }));
      if (repo.default_branch) {
        const branch = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          cwd: folder,
          encoding: "utf8",
          windowsHide: true,
          timeout: 5000,
        });
        const current = branch.status === 0 ? branch.stdout.trim() : null;
        if (current !== repo.default_branch)
          problem(
            "repo.branch",
            current === null ? "doctor.repo.branch.detached" : "doctor.repo.branch.mismatch",
            "doctor.repo.branch.fix",
            { repo: repo.path, branch: current ?? "HEAD", expected: repo.default_branch },
          );
        else lines.push(say("doctor.repo.branch.ok", { repo: repo.path, branch: current }));
      }
    }
    if (manifest?.layout === "workspace" && repo.path === ".verid") continue;
    const runners = repo.test_cmd
      ? repo.test_cmd
      : findRunners(folder, {
          sourceGlobs: repo.source_globs,
          testGlobs: repo.test_globs,
          ignoreGlobs: repo.ignore_globs ?? [],
        })
          .runners.map((r) => r.name)
          .join(", ");
    if (!runners)
      problem("repo.runner", "doctor.repo.runner.missing", "doctor.repo.runner.fix", {
        repo: repo.path,
      });
    else if (repo.test_cmd) lines.push(say("doctor.repo.runner.custom", { repo: repo.path }));
    else lines.push(say("doctor.repo.runner.ok", { repo: repo.path, runners }));
  }
  lines.push(say(problems ? "doctor.problems" : "doctor.ok", { count: String(problems) }));
  return { exit: problems ? 1 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
