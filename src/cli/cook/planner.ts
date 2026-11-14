import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Action, PlannedFile } from "../../core/setup-plan.js";
import { checkSetupPath, pathAnswers, type PathAnswers } from "../../adapters/workspace.js";
import { errno, statePaths, VeridError } from "../../adapters/state-store.js";

export const invalid = (path: string, detail: string) =>
  new VeridError("VERID_BURNT_INIT_INVALID", { path, detail });

/** What cook has decided so far: the files of the preview, and the writes behind them. */
export interface Planner {
  project: string;
  paths: ReturnType<typeof statePaths>;
  steps: PlannedFile[];
  writes: Array<{ rel: string; content: unknown; apply: () => void }>;
  machineWrites: Array<{ path: string; content: string; apply: () => void }>;
  notes: string[];
  /** Refuses a path that leaves the project or goes through a link; a loop of checks shares answers. */
  checkWritePath: (rel: string, answers?: PathAnswers) => void;
  /** One line of the preview, with the write that makes it true when there is one. */
  step: (action: Action, rel: string, write?: { content: unknown; apply: () => void }) => void;
  /** A file cook creates once and never overwrites. */
  addResource: (rel: string, content: Buffer | string) => void;
}

export function createPlanner(project: string): Planner {
  const paths = statePaths(project);
  const steps: PlannedFile[] = [];
  const writes: Array<{ rel: string; content: unknown; apply: () => void }> = [];
  const machineWrites: Array<{ path: string; content: string; apply: () => void }> = [];
  const notes: string[] = [];
  const checkWritePath = (rel: string, answers?: PathAnswers) => {
    try {
      checkSetupPath(project, rel, answers);
    } catch (error) {
      if (
        ["AGENTS.md", "CLAUDE.md"].includes(rel) &&
        error instanceof VeridError &&
        error.code === "VERID_BURNT_MANIFEST_INVALID"
      )
        throw new VeridError("VERID_BURNT_INSTRUCTIONS_LINKED", { path: rel });
      throw error;
    }
  };
  const step = (action: Action, rel: string, write?: { content: unknown; apply: () => void }) => {
    steps.push({ action, rel });
    if (write) writes.push({ rel, ...write });
  };

  const resourcesPlanned = new Set<string>();
  // Planning writes nothing, so its resource checks share one batch; apply checks afresh.
  const planned = pathAnswers();
  const addResource = (rel: string, content: Buffer | string) => {
    if (resourcesPlanned.has(rel)) return;
    resourcesPlanned.add(rel);
    checkWritePath(rel, planned);
    if (existsSync(join(project, rel))) {
      step("kept", rel);
      return;
    }
    step("created", rel, {
      content,
      apply: () => {
        mkdirSync(dirname(join(project, rel)), { recursive: true });
        writeFileSync(join(project, rel), content, { flag: "wx" });
      },
    });
  };
  return { project, paths, steps, writes, machineWrites, notes, checkWritePath, step, addResource };
}

/** Parsed JSON; a file that is missing or does not parse counts as absent. */
export function parseJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw e;
  }
}
