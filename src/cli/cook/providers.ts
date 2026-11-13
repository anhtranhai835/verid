import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { PlannedFile } from "../../core/setup-plan.js";
import type { Manifest, Provider } from "../../core/manifest.js";
import { instructionBlocks, mergeInstructions } from "../../core/instructions.js";
import { hasVeridHooks, type withVeridHooks } from "../../adapters/claude-settings.js";
import {
  codexHome,
  mergeCodexReviewer,
  reviewerOverlay,
  reviewerContent,
  withCodexHooks,
} from "../../adapters/codex-settings.js";
import { bilingual, t, type Lang } from "../../adapters/i18n.js";
import { checkSetupPath } from "../../adapters/workspace.js";
import { languageOf } from "../../adapters/state-store.js";
import { skillsFor } from "../../adapters/repo-resources.js";
import { invalid, type Planner, parseJson, readText } from "./planner.js";

const COMMANDS = ["tip", "confirm", "peek", "menu"] as const;

/** verid's block in AGENTS.md, and the import of it in CLAUDE.md. */
export function planInstructions(
  p: Planner,
  effective: Manifest | undefined,
  providers: Provider[],
): void {
  const { project, checkWritePath, step } = p;
  for (const { file: rel, block } of instructionBlocks(
    { ...effective!, providers },
    skillsFor(effective!),
  )) {
    checkWritePath(rel);
    const file = join(project, rel);
    const before = readText(file);
    const result = mergeInstructions(before ?? undefined, block);
    if (!result.ok) throw invalid(file, result.detail);
    if (before === result.content) step("kept", rel);
    else
      step(before === null ? "created" : "updated", rel, {
        content: result.content,
        apply: () => writeFileSync(file, result.content, before === null ? { flag: "wx" } : {}),
      });
  }
}

/** verid's hooks in this machine's Claude Code settings. */
export function planClaudeSettings(
  p: Planner,
  settingsFile: string,
  settingsText: string | null,
  merged: ReturnType<typeof withVeridHooks> | undefined,
): void {
  const { project, step } = p;
  if (merged) {
    const rel = ".claude/settings.local.json";
    const settingsContent = `${JSON.stringify(merged.settings, null, 2)}\n`;
    const write = {
      content: settingsContent,
      apply: () => {
        mkdirSync(join(project, ".claude"), { recursive: true });
        writeFileSync(settingsFile, settingsContent);
      },
    };
    if (settingsText === null) step("created", rel, write);
    else if (merged.changed) step("updated", rel, write);
    else step("kept", rel);
  }
}

/** Codex: the project's hooks, and the reviewer agent in the repo or on this machine. */
export function planCodex(
  p: Planner,
  providers: Provider[],
  hook: string,
  effective: Manifest | undefined,
): void {
  const { project, steps, machineWrites, notes, checkWritePath, step, addResource } = p;
  if (providers.includes("codex")) {
    const rel = ".codex/hooks.json";
    checkWritePath(rel);
    const file = join(project, rel);
    const before = readText(file);
    let next: ReturnType<typeof withCodexHooks>;
    try {
      next = withCodexHooks(before === null ? {} : JSON.parse(before), hook);
    } catch (error) {
      throw invalid(file, error instanceof Error ? error.message : String(error));
    }
    const content = `${JSON.stringify(next.settings, null, 2)}\n`;
    if (before === null || next.changed)
      step(before === null ? "created" : "updated", rel, {
        content,
        apply: () => {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, content);
        },
      });
    else step("kept", rel);

    if (effective?.resources === "repo") {
      const overlay = "../.verid/agents/verid-reviewer.toml";
      addResource(".verid/agents/verid-reviewer.toml", reviewerContent(".verid/skills"));
      const config = join(project, ".codex/config.toml");
      const before = readText(config);
      const reviewer = mergeCodexReviewer(before ?? undefined, overlay);
      if (!reviewer.ok) throw invalid(config, reviewer.detail);
      if (before !== reviewer.content)
        step(before === null ? "created" : "updated", ".codex/config.toml", {
          content: reviewer.content,
          apply: () => {
            mkdirSync(dirname(config), { recursive: true });
            writeFileSync(config, reviewer.content);
          },
        });
      else step("kept", ".codex/config.toml");
    } else {
      const machine = planCodexMachine();
      steps.push(...machine.files);
      machineWrites.push(...machine.writes);
    }
    notes.push(bilingual("cook.codex_trust", {}));
  }
}

export function planCodexMachine(): {
  files: PlannedFile[];
  writes: { path: string; content: string; apply: () => void }[];
} {
  const overlay = reviewerOverlay();
  const content = reviewerContent();
  const config = join(codexHome(), "config.toml");
  const reviewer = mergeCodexReviewer(readText(config) ?? undefined, overlay);
  if (!reviewer.ok) throw invalid(config, reviewer.detail);
  const files: PlannedFile[] = [];
  const writes: { path: string; content: string; apply: () => void }[] = [];
  for (const file of [
    { path: overlay, content },
    { path: config, content: reviewer.content },
  ]) {
    checkSetupPath(dirname(file.path), basename(file.path));
    const before = readText(file.path);
    files.push({
      rel: file.path.replaceAll("\\", "/"),
      action: before === null ? "created" : before === file.content ? "kept" : "updated",
    });
    if (before !== file.content)
      writes.push({
        ...file,
        apply: () => {
          mkdirSync(dirname(file.path), { recursive: true });
          writeFileSync(file.path, file.content);
        },
      });
  }
  return { files, writes };
}

/** `/verid:<name>` in Claude Code's menu; the files it would create or refresh. */
export function planCommands(
  p: Planner,
  claude: boolean,
  language: Lang | undefined,
  refreshCommands: boolean,
): PlannedFile[] {
  const { project, writes, step } = p;
  // verid's commands in Claude Code's menu, in this machine's language. One that is there is
  // kept: it may be the developer's own edit, or a teammate's in another language.
  const commands = join(project, ".claude", "commands", "verid");
  const lang = language ?? languageOf(project) ?? "en";
  const commandFiles: PlannedFile[] = (claude ? COMMANDS : []).map((c) => {
    const file = join(commands, `${c}.md`);
    const before = readText(file);
    const text = commandFile(lang, c);
    const action =
      before === null ? "created" : refreshCommands && before !== text ? "updated" : "kept";
    if (action !== "kept")
      writes.push({
        rel: `.claude/commands/verid/${c}.md`,
        content: text,
        apply: () => {
          mkdirSync(commands, { recursive: true });
          writeFileSync(file, text, { flag: action === "created" ? "wx" : "w" });
        },
      });
    return { action, rel: `.claude/commands/verid/${c}.md` };
  });
  if (claude)
    step(
      commandFiles.some((c) => c.action === "updated")
        ? "updated"
        : commandFiles.some((c) => c.action === "created")
          ? "created"
          : "kept",
      ".claude/commands/verid/",
    );
  return commandFiles;
}

/**
 * `/verid:<name>` for Claude Code's menu. The hook reads the line as the developer typed it, so
 * the file only lists the command; its body reaches the agent when the hook lets the prompt
 * through, or when this machine has no verid hooks. The agent never runs one by itself.
 */
function commandFile(lang: Lang, name: (typeof COMMANDS)[number]): string {
  const hint = name === "tip" || name === "confirm" ? t(lang, `command.${name}_hint`, {}) : null;
  return [
    "---",
    `description: ${JSON.stringify(t(lang, `command.${name}`, {}))}`,
    ...(hint === null ? [] : [`argument-hint: ${JSON.stringify(hint)}`]),
    "disable-model-invocation: true",
    "---",
    t(lang, "command.body", {}),
    "",
  ].join("\n");
}

/** Says so when the shared settings already register verid's hooks. */
export function noteSharedHooks(p: Planner, claude: boolean): void {
  const { project, notes } = p;
  // Set up by hand from the Phase 0 checklist: the hook would run twice. Only a warning, so a
  // shared settings.json that does not parse is Claude Code's to report, not a reason to stop.
  const shared = parseJson(readText(join(project, ".claude", "settings.json")));
  if (claude && hasVeridHooks(shared)) notes.push(bilingual("init.shared_hooks", {}));
}
