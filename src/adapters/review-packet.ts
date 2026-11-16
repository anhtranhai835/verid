import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** CLI-owned evidence outside private state, readable by reviewers. No caller-chosen paths. */
export function writeReviewPacket(project: string, text: string, history?: string): string {
  const verid = join(project, ".verid");
  const directory = join(verid, "review");
  for (const path of [verid, directory]) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory()))
      throw new Error(`review packet directory is not a plain directory: ${path}`);
  }
  mkdirSync(directory, { recursive: true });
  for (const [name, content] of [
    [".gitignore", "*\n"],
    ["work.md", text],
    ...(history === undefined ? [] : ([["history.md", history]] as const)),
  ] as const) {
    const target = join(directory, name);
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isFile()))
      throw new Error(`review packet target is not a plain file: ${target}`);
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, content, { flag: "wx" });
      // Replace the directory entry: even an existing hard link cannot redirect this write.
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return ".verid/review/work.md";
}
