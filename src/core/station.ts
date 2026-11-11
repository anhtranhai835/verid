import type { PlanModule } from "./plan.js";
import type { ErrorCode } from "./errors.js";
import { matchesGlob } from "./glob.js";

export const STATION_LIMIT = 3;

/** Module names come from the plan, so "constructor" must not find Object.prototype. */
export const ownEntry = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(map, key) ? map[key] : undefined;

/** A conservative intersection: uncertain glob intersections reserve the whole fixed prefix. */
export function boundariesOverlap(a: readonly string[], b: readonly string[]): boolean {
  const prefix = (glob: string) => glob.toLowerCase().split(/[?*]/, 1)[0]!;
  return a.some((left) =>
    b.some((right) => {
      const l = prefix(left),
        r = prefix(right);
      return l.startsWith(r) || r.startsWith(l);
    }),
  );
}

export function validBoundary(glob: string): boolean {
  return (
    glob.length > 0 &&
    !/[\\:\s\[\]{}!\0]/.test(glob) &&
    !glob.startsWith("/") &&
    glob.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
    !/^(?:\.verid|\.git|\.claude|\.codex|\.agents)(?:\/|$)/i.test(glob)
  );
}

export function stationProblem(facts: {
  module: PlanModule;
  approved: boolean;
  served: ReadonlySet<string>;
  active: readonly { module: string; boundary: readonly string[] }[];
  limit: number;
}): ErrorCode | null {
  if (!facts.approved) return "VERID_BURNT_STATION_NOT_ORDERED";
  const boundary = facts.module.boundary ?? [];
  if (!boundary.length || !boundary.every(validBoundary)) return "VERID_BURNT_STATION_BOUNDARY";
  if ((facts.module.depends ?? []).some((name) => !facts.served.has(name)))
    return "VERID_BURNT_STATION_DEPENDENCY";
  if (facts.active.length >= facts.limit) return "VERID_BURNT_STATION_LIMIT";
  if (
    facts.active.some(
      (item) => item.module === facts.module.name || boundariesOverlap(boundary, item.boundary),
    )
  )
    return "VERID_BURNT_STATION_OVERLAP";
  return null;
}

export const inBoundary = (path: string, boundary: readonly string[]): boolean =>
  boundary.some((glob) => matchesGlob(path, glob));
