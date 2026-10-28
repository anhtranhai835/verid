import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { node22OrLater } from "../core/doctor.js";
import { instructionBlock, instructionFile, renderInstructions } from "../core/instructions.js";
import { hasCurrentVeridHooks } from "../adapters/claude-settings.js";
import {
  codexHome,
  codexHookKeys,
  codexTrust,
  hasCodexReviewer,
  hasCurrentCodexHooks,
  installedSkills,
  reviewerOverlay,
  reviewerContent,
} from "../adapters/codex-settings.js";
import { bilingual, inLanguage, t } from "../adapters/i18n.js";
import { declaredMains, gitView, readHistories, repoFacts, workRoots } from "../adapters/git.js";
import { closeHistory, isWorkBranch } from "../core/git-convention.js";
import { isDirectory, loadManifest } from "../adapters/manifest.js";
import { checkedRepos, contentsOf, WORD } from "../adapters/architecture.js";
import { architectureOf, moduleClosing, openWork } from "../adapters/plan-file.js";
import { errno, readState, statePaths, VeridError } from "../adapters/state-store.js";
import { findRunners } from "../adapters/test-runner.js";
import { repoFolder } from "../adapters/workspace.js";
import { ROLE_NAMES, type Manifest } from "../core/manifest.js";
import type { ErrorCode, MessageKey } from "../core/errors.js";
import { parseState, type State } from "../core/state.js";
import type { CliResult } from "./test.js";

/** Read-only checks: never run a test, repair settings, or write the manifest cache. */
export async function doctorCommand(project: string): Promise<CliResult> {
  const say = (key: MessageKey, params: Record<string, string> = {}) => bilingual(key, params);
  const lines = [say("doctor.header", { project })];
  let problems = 0;
  const problem = (
    key: string,
    detail: MessageKey | ErrorCode,
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

  if (!manifest || manifest.providers.includes("claude-code")) {
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
    // An install record of this plugin that applies here: for the user, or for this project.
    const applicable = (name: string) =>
      Object.entries(installed).flatMap(([key, entries]) =>
        key.startsWith(`${name}@`) && Array.isArray(entries)
          ? entries.filter(
              (entry: unknown): entry is { installPath: string } =>
                isObject(entry) &&
                typeof entry.installPath === "string" &&
                isDirectory(entry.installPath) &&
                (entry.scope === "user" ||
                  (["project", "local"].includes(String(entry.scope)) &&
                    typeof entry.projectPath === "string" &&
                    resolve(entry.projectPath) === resolve(project))),
            )
          : [],
      );
    for (const [name, marketplace, source] of [
      ["superpowers", "superpowers-marketplace", "obra/superpowers-marketplace"],
      ["andrej-karpathy-skills", "karpathy-skills", "forrestchang/andrej-karpathy-skills"],
      ["verid", "verid", "anhtranhai835/verid"],
    ] as const) {
      const found = applicable(name).length > 0;
      if (!found)
        problem(`plugin.${name}`, "doctor.plugin.missing", "doctor.plugin.fix", {
          name,
          source,
          marketplace,
        });
      else lines.push(say("doctor.plugin.ok", { name }));
    }
    // A mapped verid agent ("verid:<name>") needs an install of verid that has it, as an older
    // install lacks the agents a newer verid maps. Other plugins may name agents by frontmatter or
    // declare their own paths, so verid cannot tell; without verid, plugin.verid says what to install.
    const verids = applicable("verid");
    if (verids.length > 0)
      for (const role of ROLE_NAMES)
        for (const agent of manifest?.roles?.[role] ?? []) {
          const [plugin, name] = agent.split(":");
          if (plugin !== "verid" || !name) continue;
          const provided = verids.some((entry) =>
            existsSync(join(entry.installPath, "agents", `${name}.md`)),
          );
          if (!provided)
            problem(`agent.${agent}`, "doctor.agent.missing", "doctor.agent.fix", {
              agent,
              role,
              plugin,
            });
        }
  }
  for (const provider of manifest?.providers ?? []) {
    const file = instructionFile(provider);
    let text: string | undefined;
    try {
      text = readFileSync(join(project, file), "utf8").replaceAll("\r\n", "\n");
    } catch {
      // Missing and unreadable instruction files both require a developer repair.
    }
    const block = text === undefined ? { ok: true as const, block: null } : instructionBlock(text);
    if (block.ok && block.block === null)
      problem(
        `instructions.${provider}`,
        "doctor.instructions.missing",
        "doctor.instructions.fix",
        { file },
      );
    else if (
      !block.ok ||
      block.block !== renderInstructions(manifest!, provider, installedSkills())
    )
      problem(`instructions.${provider}`, "doctor.instructions.edited", "doctor.instructions.fix", {
        file,
      });
    else lines.push(say("doctor.instructions.ok", { file }));
    if (provider === "codex") {
      const hook = fileURLToPath(new URL("./hook.js", import.meta.url));
      const hookFile = join(project, ".codex", "hooks.json");
      let settings: unknown;
      try {
        settings = JSON.parse(readFileSync(hookFile, "utf8"));
      } catch {
        /* Report below. */
      }
      if (!hasCurrentCodexHooks(settings, hook))
        problem("codex.hooks", "doctor.codex.hooks_missing", "doctor.hooks.fix");
      else lines.push(say("doctor.codex.hooks_ok"));
      let config = "";
      try {
        config = readFileSync(join(codexHome(), "config.toml"), "utf8");
      } catch {
        /* Missing configuration is untrusted. */
      }
      const trust = codexTrust(config, project, codexHookKeys(settings, hookFile, hook));
      if (!trust.project)
        problem(
          "codex.project_trust",
          "doctor.codex.project_untrusted",
          "doctor.codex.project_fix",
        );
      else lines.push(say("doctor.codex.project_ok"));
      if (!trust.hooks)
        problem("codex.hook_trust", "doctor.codex.hooks_untrusted", "doctor.codex.hooks_fix");
      else lines.push(say("doctor.codex.trust_ok"));
      // Codex's internal definition hash serialization is not part of the captured contract.
      lines.push(say("doctor.codex.retrust"));
      let overlayCurrent = false;
      try {
        overlayCurrent =
          readFileSync(reviewerOverlay(), "utf8").replaceAll("\r\n", "\n") ===
          reviewerContent().replaceAll("\r\n", "\n");
      } catch {
        /* Missing or unreadable installation needs upgrade. */
      }
      if (
        !overlayCurrent ||
        !hasCodexReviewer(config, reviewerOverlay()) ||
        !manifest!.roles?.reviewer?.includes("verid_reviewer")
      )
        problem("codex.reviewer", "doctor.codex.reviewer_missing", "doctor.hooks.fix");
      else lines.push(say("doctor.codex.reviewer_ok"));
      const version = spawnSync(
        process.platform === "win32" ? "codex.cmd" : "codex",
        ["--version"],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 5000,
          shell: process.platform === "win32",
        },
      );
      const actual = version.status === 0 ? version.stdout.trim() : "unavailable";
      if (!/^codex-cli 0\.164\.0$/.test(actual))
        lines.push(say("doctor.codex.version_warning", { version: actual }));
      else lines.push(say("doctor.codex.version_ok"));
    }
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
  // Git as the hook and the close read it, offline: main and the branch in each root, then the
  // open module's history. A count of commits is only noted.
  if (manifest) {
    const roots = workRoots(project, manifest);
    if (!Array.isArray(roots))
      problem("repo.main", "doctor.repo.main", "doctor.repo.main.fix", {
        repo: roots.repo,
        detail: roots.error,
      });
    let declared: Map<string, string[]> | { error: string } | undefined;
    for (const { repo, top } of Array.isArray(roots) ? roots : []) {
      const facts = repoFacts(
        top,
        manifest.git?.default_branch,
        () => (declared ??= declaredMains(project, manifest!)),
      );
      const detail = "error" in facts ? facts.error : facts.main.ok ? null : facts.main.detail;
      if (detail !== null || "error" in facts || !facts.main.ok)
        problem("repo.main", "doctor.repo.main", "doctor.repo.main.fix", {
          repo,
          detail: detail ?? "",
        });
      else if (facts.branch === null)
        problem("repo.branch", "doctor.repo.branch.detached", "doctor.repo.branch.fix", { repo });
      else if (facts.branch !== facts.main.main && !isWorkBranch(facts.branch))
        problem("repo.branch", "doctor.repo.branch.mismatch", "doctor.repo.branch.fix", {
          repo,
          branch: facts.branch,
          main: facts.main.main,
        });
      else lines.push(say("doctor.repo.branch.ok", { repo, branch: facts.branch }));
    }
    let open: ReturnType<typeof openWork> = null;
    try {
      open = openWork(project, manifest, readState(statePaths(project)));
    } catch (e) {
      if (!(e instanceof VeridError)) throw e; // no state yet, or state the hook reports itself
    }
    if (open?.work !== undefined) {
      const history = closeHistory(readHistories(project, open.work));
      if (history.problem)
        problem("module.history", history.problem.code, "doctor.module.history.fix", {
          module: open.module,
          ...history.problem.params,
        });
      for (const { repo, commits } of history.counts)
        lines.push(say("git.commits", { module: open.module, repo, count: String(commits) }));
    } else if (open && manifest.drive !== "auto" && Array.isArray(roots) && roots.length > 0)
      problem("module.history", "VERID_BURNT_GIT_WORK_BASE", "doctor.module.history.fix", {
        module: open.module,
        repo: roots[0]!.repo,
        detail: "ordered before verid recorded where work begins",
      });
  }
  // A configured architecture check is named, never run: its evidence comes from taste alone.
  if (manifest && checkedRepos(manifest).length > 0) {
    for (const { repo, check } of checkedRepos(manifest))
      lines.push(
        say("doctor.architecture.configured", { repo: repo.path, command: check.command }),
      );
    let state: State | null = null;
    try {
      state = readState(statePaths(project));
    } catch (e) {
      if (!(e instanceof VeridError)) throw e;
      // No state yet: no check has run either. Broken state is a problem of its own.
      const fresh = parseState('{"schemaVersion":1}');
      if (e.code === "VERID_BURNT_STATE_MISSING" && fresh.ok) state = fresh.state;
      else problem("architecture.state", e.code, "doctor.architecture.fix", e.params);
    }
    const contents = state ? contentsOf(project, manifest) : {};
    // Missing or stale evidence blocks only a module waiting to close; an input or file the
    // check cannot read is a setup problem whenever it shows.
    const closing = state !== null && moduleClosing(project, state, manifest);
    for (const p of state ? architectureOf(project, manifest, state, contents) : []) {
      const setup = "unavailable" in (contents[p.repo] ?? {});
      if (closing || setup)
        problem(`architecture.${p.repo}`, p.code, "doctor.architecture.fix", {
          repo: p.repo,
          detail: p.detail,
          log: p.log,
        });
      else lines.push(say("doctor.architecture.idle", { repo: p.repo, status: WORD[p.code] }));
    }
  }
  lines.push(say(problems ? "doctor.problems" : "doctor.ok", { count: String(problems) }));
  return { exit: problems ? 1 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
