import { isConventionalCommit } from "./git-convention.js";

const RECORD = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) [A-Z]\d*$/;

/**
 * A change as Git's tree entries see it, from `git diff --raw --no-renames --no-abbrev -z`: every
 * path with its old and new mode and object id, sorted, so two diffs with the same content give
 * the same key whatever commits they came from. Text, messages and patch ids play no part. Paths
 * arrive unquoted, as -z prints them; null when the output is not that format.
 */
export function netChange(raw: string): { files: number; key: string } | null {
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 2 !== 0) return null;
  const entries: string[][] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const m = RECORD.exec(fields[i]!);
    if (!m) return null;
    entries.push([fields[i + 1]!, m[1]!, m[2]!, m[3]!, m[4]!]);
  }
  entries.sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
  return { files: entries.length, key: JSON.stringify(entries) };
}

/** A commit on main's first-parent line after the module's base, as the adapter read it. */
export interface MainCommit {
  sha: string;
  parents: number;
  /** netChange(parent..commit).key */
  key: string;
  message: string;
}

/**
 * The squash commit that brought a module's recorded change into main: one parent, exactly the
 * same tree entries, and a Conventional Commit message. Content alone is the evidence, never a
 * merge, a message or a branch that is gone; a split or conflict-edited integration finds none.
 */
export function squashOf(recorded: string, commits: readonly MainCommit[]): string | null {
  const hit = commits.find(
    (c) => c.parents === 1 && c.key === recorded && isConventionalCommit(c.message),
  );
  return hit?.sha ?? null;
}
