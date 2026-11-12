import { planned } from "../core/manifest.js";
import { loadManifest, manifestFile } from "../adapters/manifest.js";
import { planFile, readPlan, servedSections } from "../adapters/plan-file.js";
import { readState, statePaths, VeridError } from "../adapters/state-store.js";

/**
 * What `order` and `serve` share: a prep or recipe manifest, a readable plan, and the module
 * asked for. Without a name, a plan of one module (main included) means that module.
 */
export async function planModule(project: string, command: string, wanted: string | undefined) {
  const manifest = await loadManifest(project);
  if (!manifest)
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  const { mode } = manifest;
  if (mode === "remix") throw new VeridError("VERID_BURNT_MODE_MISMATCH", { command, mode });
  const file = planFile(project);
  const state = readState(statePaths(project));
  if (
    state.station &&
    ["order", "serve"].includes(command) &&
    wanted !== undefined &&
    wanted !== state.station.module
  )
    throw new VeridError("VERID_BURNT_STATION_INVALID", {
      detail: `this station owns ${state.station.module}`,
    });
  const plan = readPlan(
    project,
    manifest.iterations !== undefined,
    planned(manifest),
    servedSections(state),
  );
  if (plan === null) throw new VeridError("VERID_BURNT_PLAN_MISSING", { path: file });
  if (!plan.ok)
    throw new VeridError("VERID_BURNT_PLAN_INVALID", { path: file, detail: plan.detail });
  const names = plan.modules.map((m) => m.name);
  const name = wanted ?? (names.length === 1 ? names[0] : undefined);
  if (name === undefined)
    throw new VeridError("VERID_BURNT_MODULE_REQUIRED", { modules: names.join(", ") });
  const module = plan.modules.find((m) => m.name === name);
  if (!module)
    throw new VeridError("VERID_BURNT_MODULE_UNKNOWN", { module: name, modules: names.join(", ") });
  return { mode, plan, name, module, manifest };
}
