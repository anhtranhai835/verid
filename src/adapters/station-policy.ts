import { sameFolder, stationContext } from "./project.js";
import { normalizePath, writtenPath, type FileAction } from "./claude-code.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PolicyContext } from "../core/policy.js";

export function stationPolicy(
  project: string,
  cwd = project,
  writes: readonly FileAction[] = [],
): Pick<PolicyContext, "station"> {
  const context = stationContext(project);
  if (!context) return {};
  if (!context.station && !Object.keys(context.state.stations).length) return {};
  let writtenRoot = resolve(cwd);
  while (!existsSync(join(writtenRoot, ".git")) && dirname(writtenRoot) !== writtenRoot)
    writtenRoot = dirname(writtenRoot);
  const aliases = new Set([writtenPath(writtenRoot)]);
  for (const write of writes) {
    if (!write.written) continue;
    let root = resolve(write.written);
    while (!existsSync(join(root, ".git")) && dirname(root) !== root) root = dirname(root);
    if (existsSync(join(root, ".git")) && sameFolder(root, context.root))
      aliases.add(writtenPath(root));
  }
  return {
    station: {
      root: normalizePath(context.root),
      writtenRoot: writtenPath(writtenRoot),
      aliases: [...aliases].sort((a, b) => b.length - a.length),
      module: context.station?.module ?? null,
      boundary: context.station?.boundary ?? [],
      frozen: context.station
        ? context.station.stage !== "open"
        : Object.values(context.state.stations).some((item) => item.stage === "integrating"),
      reserved: Object.values(context.state.stations).map((item) => ({
        root: normalizePath(item.path),
        boundary: item.boundary,
      })),
    },
  };
}
