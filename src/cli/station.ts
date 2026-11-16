import { inAgentShell } from "../adapters/agent-environment.js";
import { loadManifest } from "../adapters/manifest.js";
import { closeStation, openStation, scheduleStations } from "../adapters/station.js";
import { readState, statePaths, VeridError } from "../adapters/state-store.js";
import { stationContext } from "../adapters/project.js";
import { testCommand, type CliResult } from "./test.js";

export async function stationCommand(project: string, args: readonly string[]): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_STATION_IN_AGENT");
  const context = stationContext(project);
  if (args.length === 1 && args[0] === "list") {
    const state = readState(statePaths(context?.project ?? project));
    return {
      exit: 0,
      stdout: Object.values(state.stations)
        .map((item) => `${item.module}\t${item.stage}\t${item.branch}\t${item.path}\n`)
        .join(""),
      stderr: "",
    };
  }
  if (context?.station)
    throw new VeridError("VERID_BURNT_STATION_INVALID", {
      detail: "run station from the primary worktree",
    });
  const manifest = await loadManifest(project);
  if (!manifest) throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: project });
  if (args[0] === "close" && args.length === 2) {
    const result = await closeStation(project, args[1]!, manifest, testCommand);
    if (result.exit === 0) scheduleStations(project, manifest);
    return result;
  }
  if (
    args.length !== 1 ||
    !/^[a-z0-9][a-z0-9-]*$/.test(args[0]!) ||
    ["close", "list"].includes(args[0]!)
  )
    throw new VeridError("VERID_BURNT_STATION_INVALID", {
      detail: "station <module> | station list | station close <module>",
    });
  const station = openStation(project, args[0]!, manifest);
  return { exit: 0, stdout: `verid: station ${station.module}\n${station.path}\n`, stderr: "" };
}
