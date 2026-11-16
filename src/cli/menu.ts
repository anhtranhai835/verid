import { bilingual } from "../adapters/i18n.js";
import { loadManifest, manifestFile } from "../adapters/manifest.js";
import { compactWorkLog, workLog } from "../adapters/git.js";
import { menuLines, openWork } from "../adapters/plan-file.js";
import { readState, statePaths, VeridError } from "../adapters/state-store.js";
import { writeReviewPacket } from "../adapters/review-packet.js";
import type { CliResult } from "./test.js";

/** `verid menu`: the plan's modules, where each one stands, and the one next step. */
export async function menu(project: string): Promise<CliResult> {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const state = readState(statePaths(project));
  const lines = menuLines(project, manifest.mode, state, manifest.roles, manifest.drive, manifest);
  return {
    exit: 0,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
  };
}

/** The flags after `menu --commits`: `--file`, and `--compact` only with it, each at most once. */
export const commitFlags = (flags: string[]): boolean =>
  new Set(flags).size === flags.length &&
  flags.every((f) => f === "--file" || f === "--compact") &&
  (!flags.includes("--compact") || flags.includes("--file"));

/**
 * `verid menu --commits`: the open module's work as Git shows it, for a reviewer that cannot run
 * Git: every commit since the recorded start with its message and diff, then what is uncommitted.
 * With --file, write the evidence to a protected, reviewer-readable packet and print its path.
 * With --compact too, the packet is one diff from the base and the per-commit history goes to
 * `history.md` beside it.
 * Secret files and verid's state are never shown.
 */
export async function commits(project: string, file = false, compact = false): Promise<CliResult> {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const open = openWork(project, manifest, readState(statePaths(project)));
  const say = (text: string) => ({ exit: 0 as const, stdout: `${text}\n`, stderr: "" });
  if (open === null) return say(bilingual("commits.none", {}));
  const { module, work } = open;
  const history =
    work === undefined
      ? [bilingual("commits.no_record", { module })]
      : Object.keys(work).length === 0
        ? [bilingual("git.no_history", { module })]
        : workLog(project, work);
  const short =
    compact && work !== undefined && Object.keys(work).length > 0
      ? compactWorkLog(project, work)
      : undefined;
  const text = [
    `verid: work history of module ${module}`,
    ...(file
      ? [
          "Plan: .verid/plan.md",
          "Design: .verid/design.md",
          "Read changed and new files at their paths; the snapshot below may be truncated.",
        ]
      : []),
    ...(short ?? history),
  ].join("\n");
  const full = `verid: work history of module ${module}\n${history.join("\n")}\n`;
  return say(
    file
      ? writeReviewPacket(project, `${text}\n`, short === undefined ? undefined : full)
      : work === undefined || Object.keys(work).length === 0
        ? history.join("\n")
        : text,
  );
}
