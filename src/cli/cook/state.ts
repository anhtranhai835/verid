import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "../../core/manifest.js";
import { goneRunners, runnerKey, runnerLabel } from "../../core/runners.js";
import { bilingual, systemLanguage, type Lang } from "../../adapters/i18n.js";
import { readState, withLock, writeState } from "../../adapters/state-store.js";
import type { Sees } from "./inputs.js";
import { type Planner, readText } from "./planner.js";

/** This machine's state: created, or its language and forgotten runners updated. */
export function planState(
  p: Planner,
  existing: Manifest | null,
  language: Lang | undefined,
  sees: Sees,
  scopedRunners: boolean,
): void {
  const { paths, notes, step } = p;
  if (existsSync(paths.file)) {
    const state = readState(paths); // a broken state stops cook: the developer must look at it
    // The developer running cook again is how a runner whose build file is gone is dropped.
    const now = existing?.repos.flatMap(
      (repo) => sees(repo)?.runners.map((r) => runnerKey(r, scopedRunners ? repo.path : ".")) ?? [],
    );
    const gone = now ? goneRunners(state.runners, now) : [];
    if (gone.length > 0)
      notes.push(
        bilingual("init.runners_forgotten", { runners: gone.map(runnerLabel).join(", ") }),
      );
    if ((language && state.language !== language) || gone.length > 0)
      step("updated", ".verid/.state/state.json", {
        // Compare only the merge we will perform, not fields hooks keep updating.
        content: { ...(language && { language }), forgetRunners: gone },
        apply: () =>
          withLock(paths, () => {
            const s = readState(paths);
            writeState(paths, {
              ...s,
              ...(language && { language }),
              runners: s.runners.filter((k) => !gone.includes(k)),
            });
          }),
      });
    else step("kept", ".verid/.state/state.json");
  } else {
    // Every other field has a default (core/state.ts). Without --lang the system's language is
    // kept, so this machine's messages come in one language rather than in both.
    const fresh = {
      schemaVersion: 1,
      language: language ?? systemLanguage(),
    };
    const text = `${JSON.stringify(fresh)}\n`;
    step("created", ".verid/.state/state.json", {
      content: text,
      apply: () => writeFileSync(paths.file, text, { flag: "wx" }),
    });
  }
}

/** `.verid/.gitignore`: state is never committed, nor is a plugin's code. */
export function planGitignore(p: Planner): void {
  const { project, step } = p;
  const gitignore = join(project, ".verid", ".gitignore");
  const ignoreBefore = readText(gitignore);
  const initialIgnore = ignoreBefore ?? ".state/\n";
  const ignoreAfter =
    !existsSync(join(project, ".verid/plugins.json")) || /^\/?\.plugins\/$/m.test(initialIgnore)
      ? initialIgnore
      : `${initialIgnore}${initialIgnore.endsWith("\n") ? "" : "\n"}.plugins/\n`;
  if (ignoreBefore === ignoreAfter) step("kept", ".verid/.gitignore");
  // `wx`: a file that appeared since the check is the developer's, never overwritten.
  else
    step(ignoreBefore === null ? "created" : "updated", ".verid/.gitignore", {
      content: ignoreAfter,
      apply: () =>
        writeFileSync(gitignore, ignoreAfter, ignoreBefore === null ? { flag: "wx" } : {}),
    });
}
