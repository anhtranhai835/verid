import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { folderKey, runGit } from "./git.js";
import { readState, statePaths, VeridError, withLock, writeState } from "./state-store.js";
import type { State } from "../core/state.js";
import { normalizePath } from "./claude-code.js";

export const canonicalFolder = (path: string): string => realpathSync.native(normalizePath(path));
export const sameFolder = (a: string, b: string): boolean =>
  folderKey(canonicalFolder(a)) === folderKey(canonicalFolder(b));

function ancestor(cwd: string, entry: string, canonical = true): string | null {
  for (let dir = canonical ? normalizePath(cwd) : resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, entry))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export interface StationContext {
  project: string;
  root: string;
  state: State;
  station: State["stations"][string] | null;
}

/** Git identifies the parent; a worktree's own state is never proof of registration. */
export function stationContext(cwd: string): StationContext | null {
  const candidate = ancestor(cwd, ".git");
  if (!candidate) return null;
  const root = canonicalFolder(candidate);
  if (statSync(join(root, ".git")).isDirectory()) {
    // Ordinary projects keep their existing resolver, including handling of malformed state later.
    if (!existsSync(statePaths(root).file)) return null;
    try {
      const state = readState(statePaths(root));
      if (!Object.keys(state.stations).length && !Object.keys(state.station_sessions).length)
        return null;
    } catch {
      return null;
    }
  }
  const git = runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (git.status !== 0) throw new VeridError("VERID_BURNT_STATION_INVALID", { detail: git.stderr });
  const common = canonicalFolder(git.stdout.trim());
  // Stations are supported only for a primary, non-bare repository with its own .git directory.
  const project = dirname(common);
  if (!existsSync(join(project, ".verid"))) return null;
  const linked = !sameFolder(root, project);
  const paths = statePaths(project);
  if (!existsSync(paths.file)) {
    if (linked) throw new VeridError("VERID_BURNT_STATION_UNREGISTERED", { detail: root });
    return null;
  }
  let state: State;
  try {
    state = readState(paths);
  } catch (error) {
    if (!linked) return null;
    throw error;
  }
  if (!linked && !Object.keys(state.stations).length && !Object.keys(state.station_sessions).length)
    return null;
  if (!linked) return { project, root, state, station: null };
  const station = Object.values(state.stations).find(
    (item) => existsSync(item.path) && sameFolder(item.path, root),
  );
  if (!station || !sameFolder(station.common, common) || station.stage === "opening")
    throw new VeridError("VERID_BURNT_STATION_UNREGISTERED", { detail: root });
  const branch = runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.status !== 0 || branch.stdout.trim() !== station.branch)
    throw new VeridError("VERID_BURNT_STATION_INVALID", { detail: `branch: ${root}` });
  return { project, root, state, station };
}

/** CLI and every hook use cwd for registered stations, regardless of inherited provider roots. */
export function resolveProject(cwd: string, fallback?: string): string {
  const station = stationContext(cwd);
  if (station) return station.root;
  if (fallback) return fallback;
  return ancestor(cwd, ".verid", false) ?? cwd;
}

/** The registry lock serializes claims across roots; a second root cannot reuse a provider ID. */
export function stationSessionProblem(
  project: string,
  session: string,
  claim = false,
): string | null {
  const context = stationContext(project);
  if (!context) return null;
  const paths = statePaths(context.project);
  return withLock(paths, () => {
    const state = readState(paths);
    const owner = state.station_sessions[session];
    const identity = `${folderKey(context.root)}\0${context.station?.at ?? ""}`;
    if (owner && owner !== identity) return session;
    const local = readState(statePaths(context.root));
    if (
      context.station &&
      (!local.station ||
        local.station.module !== context.station.module ||
        !sameFolder(local.station.project, context.project))
    )
      return session;
    const usedElsewhere = Object.entries(state.kanban.sessions).some(
      ([key]) => key === session && context.station !== null,
    );
    if (!owner && usedElsewhere) return session;
    if (claim && !owner)
      writeState(paths, {
        ...state,
        station_sessions: { ...state.station_sessions, [session]: identity },
      });
    return null;
  });
}
