import { planned } from "../core/manifest.js";
import { spawnSync } from "node:child_process";
import { antigravityPluginInstalled } from "../adapters/antigravity-settings.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { node22OrLater } from "../core/doctor.js";
import { instructionBlock, instructionBlocks } from "../core/instructions.js";
import { hasCurrentVeridHooks } from "../adapters/claude-settings.js";
import {
  codexHome,
  codexHookKeys,
  codexTrust,
  hasCodexReviewer,
  hasCurrentCodexHooks,
  reviewerOverlay,
  reviewerContent,
} from "../adapters/codex-settings.js";
import { bilingual, inLanguage, t } from "../adapters/i18n.js";
import { gitView } from "../adapters/git.js";
import { verifyAuditChain } from "../adapters/audit-log.js";
import { auditLines, traceFindings } from "../adapters/rule-audit.js";
import { isDirectory, loadManifest } from "../adapters/manifest.js";
import { checkedRepos } from "../adapters/architecture.js";
import { errno, readState, statePaths, VeridError } from "../adapters/state-store.js";
import { findRunners } from "../adapters/test-runner.js";
import { checkSetupPath, repoFolder } from "../adapters/workspace.js";
import { skillsFor } from "../adapters/repo-resources.js";
import { ROLE_NAMES, type Manifest } from "../core/manifest.js";
import { dossierStatus, readPlan, servedModules } from "../adapters/plan-file.js";
import type { ErrorCode, MessageKey } from "../core/errors.js";
import type { CliResult } from "./test.js";

/**
 * Read-only checks: never run a test, repair settings, or write the manifest cache. With `ci`,
 * only what a fresh clone holds: no hook wiring, provider install or trust of this machine, and
 * nothing that needs verid state; spec and plan traceability warnings count as problems.
 */
export async function doctorCommand(project: string, ci = false): Promise<CliResult> {
  const say = (key: MessageKey, params: Record<string, string> = {}) => bilingual(key, params);
  const lines = [say("doctor.header", { project }), ...(ci ? [say("doctor.ci.scope")] : [])];
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

  if (!ci && (!manifest || manifest.providers.includes("claude-code"))) {
    const settingsFile = join(project, ".claude/settings.local.json");
    const hook =
      manifest?.resources === "repo"
        ? join(project, ".verid/hooks/hook.js")
        : fileURLToPath(new URL("./hook.js", import.meta.url));
    let currentHooks = false;
    try {
      currentHooks = hasCurrentVeridHooks(JSON.parse(readFileSync(settingsFile, "utf8")), hook);
    } catch {
      // Missing, unreadable or malformed settings need the developer's attention.
    }
    if (!currentHooks) problem("hooks", "doctor.hooks.missing", "doctor.hooks.fix");
    else lines.push(say("doctor.hooks.ok"));

    if (manifest?.resources !== "repo") {
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
  }
  const blocks = manifest ? instructionBlocks(manifest, skillsFor(manifest)) : [];
  if (manifest?.resources === "repo") {
    const skills = [
      "ba",
      "design",
      "plan",
      "build",
      "tdd",
      "review",
      "security",
      "onboard",
      ...(planned(manifest) ? ["modules"] : []),
    ];
    const required = [
      ".verid/hooks/hook.js",
      ".verid/hooks/cli.js",
      ".verid/verid.mjs",
      ".verid/hooks/package.json",
      ".verid/templates/codex-reviewer.toml",
      ".verid/i18n/en.json",
      ".verid/i18n/vi.json",
      ...skills.flatMap((name) => [
        `.verid/skills/${name}/SKILL.md`,
        ...(manifest.providers.includes("codex") ? [`.agents/skills/verid-${name}/SKILL.md`] : []),
        ...(manifest.providers.includes("claude-code")
          ? [`.claude/skills/verid-${name}/SKILL.md`]
          : []),
      ]),
      ...Object.values(manifest.roles ?? {}).flatMap((names) =>
        (names ?? []).flatMap((name) =>
          name.startsWith("verid-") && manifest.providers.includes("claude-code")
            ? [`.claude/agents/${name}.md`, `.verid/agents/${name.slice(6)}.md`]
            : [],
        ),
      ),
    ];
    for (const file of required) {
      try {
        checkSetupPath(project, file);
        if (!existsSync(join(project, file))) throw new Error("missing");
      } catch {
        problem(`resources.${file}`, "doctor.resources_missing", "doctor.resources_fix", { file });
      }
    }
  }
  for (const { file, block: expected } of blocks) {
    let text: string | undefined;
    try {
      text = readFileSync(join(project, file), "utf8").replaceAll("\r\n", "\n");
    } catch {
      // Missing and unreadable instruction files both require a developer repair.
    }
    const block = text === undefined ? { ok: true as const, block: null } : instructionBlock(text);
    if (block.ok && block.block === null)
      problem(`instructions.${file}`, "doctor.instructions.missing", "doctor.instructions.fix", {
        file,
      });
    else if (!block.ok || block.block !== expected)
      problem(`instructions.${file}`, "doctor.instructions.edited", "doctor.instructions.fix", {
        file,
      });
    else lines.push(say("doctor.instructions.ok", { file }));
  }
  for (const provider of ci ? [] : (manifest?.providers ?? [])) {
    if (provider === "antigravity") {
      if (antigravityPluginInstalled()) lines.push(say("doctor.antigravity.plugin_ok"));
      else
        problem(
          "antigravity.plugin",
          "doctor.antigravity.plugin_missing",
          "doctor.antigravity.plugin_fix",
        );
      continue;
    }
    if (provider === "codex") {
      const local = manifest?.resources === "repo";
      const hook = local
        ? join(project, ".verid/hooks/hook.js")
        : fileURLToPath(new URL("./hook.js", import.meta.url));
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
      const overlay = local
        ? join(project, ".verid/agents/verid-reviewer.toml")
        : reviewerOverlay();
      let reviewerConfig = config;
      if (local) {
        try {
          reviewerConfig = readFileSync(join(project, ".codex/config.toml"), "utf8");
        } catch {
          reviewerConfig = "";
        }
      }
      let overlayCurrent = false;
      try {
        overlayCurrent = local
          ? readFileSync(overlay, "utf8").includes('sandbox_mode = "read-only"')
          : readFileSync(overlay, "utf8").replaceAll("\r\n", "\n") ===
            reviewerContent().replaceAll("\r\n", "\n");
      } catch {
        /* Missing or unreadable installation needs upgrade. */
      }
      if (
        !overlayCurrent ||
        !hasCodexReviewer(
          reviewerConfig,
          local ? "../.verid/agents/verid-reviewer.toml" : overlay,
        ) ||
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
    if (!git) lines.push(say("doctor.repo.git.missing", { repo: repo.path }));
    else {
      if (!git.clean) lines.push(say("doctor.repo.dirty", { repo: repo.path }));
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
  if (manifest) {
    if (manifest.workflow !== undefined)
      problem("workflow.legacy", "doctor.workflow_legacy", "doctor.workflow_fix", {
        workflow: manifest.workflow,
      });
    for (const { repo, check } of checkedRepos(manifest))
      lines.push(
        say("doctor.architecture.configured", { repo: repo.path, command: check.command }),
      );
    if (ci)
      for (const [code, detail] of traceFindings(project, manifest))
        problem(code, "doctor.manifest.invalid", "doctor.ci.trace_fix", { detail });
    else
      try {
        const state = readState(statePaths(project));
        lines.push(...auditLines(project, manifest, state));
        if (planned(manifest)) {
          const plan = readPlan(
            project,
            manifest.iterations !== undefined,
            false,
            servedModules(state),
            true,
          );
          if (plan?.ok)
            for (const module of plan.modules) {
              if (
                servedModules(state).has(module.name) &&
                state.modules[module.name]?.sha256 === plan.hashes[module.name]
              )
                continue;
              const dossier = dossierStatus(project, module);
              if (dossier.problem)
                problem(`module.${module.name}`, "doctor.module_dossier", "doctor.module_fix", {
                  module: module.name,
                  detail: dossier.problem,
                });
            }
        }
      } catch (err) {
        if (err instanceof VeridError && err.code !== "VERID_BURNT_STATE_MISSING")
          problem("state", err.code, "doctor.architecture.fix", err.params);
        else
          lines.push(
            `verid: audit unavailable: ${err instanceof Error ? err.message : String(err)}`,
          );
      }
  }
  // The hash chain detects an edited or removed entry; nothing else ever checks it.
  const audit = statePaths(project).audit;
  if (!ci && existsSync(audit)) {
    const chain = verifyAuditChain(audit);
    if (!chain.ok)
      problem("audit", "doctor.audit.broken", "doctor.audit.fix", {
        file: ".verid/.state/audit.jsonl",
        line: String(chain.line),
      });
  }
  lines.push(say(problems ? "doctor.problems" : "doctor.ok", { count: String(problems) }));
  return { exit: problems ? 1 : 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
