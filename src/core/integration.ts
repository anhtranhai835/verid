import { inBoundary } from "./station.js";
import { stationOutput } from "./policy.js";

/** Squash may bring only this module's declared files and its execution outputs. */
export function integrationProblem(
  files: readonly string[],
  module: string,
  boundary: readonly string[],
): string | null {
  return files.find((file) => !inBoundary(file, boundary) && !stationOutput(file, module)) ?? null;
}
