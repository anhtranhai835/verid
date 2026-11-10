import { loadManifest } from "../adapters/manifest.js";
import { scaffoldModule } from "../adapters/module-scaffold.js";
import { VeridError } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";
import { planned } from "../core/manifest.js";

/** Drafts only: never creates a plan, approval, test result or review verdict. */
export async function moduleCommand(project: string, name: string): Promise<CliResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name))
    throw new VeridError("VERID_BURNT_INIT_INVALID", {
      path: "module",
      detail: "use a kebab-case module name, up to 80 characters",
    });
  const manifest = await loadManifest(project, { readOnly: true });
  if (!manifest || !planned(manifest))
    throw new VeridError("VERID_BURNT_INIT_INVALID", {
      path: "mode",
      detail: "verid module needs mode prep or recipe",
    });
  const base = `.verid/artifacts/03-modules/${name}`;
  const lines = scaffoldModule(project, name);
  return {
    exit: 0,
    stdout: `${lines.join("\n")}\nFill the module drafts, then add its ACs and Artifacts: ${base} to .verid/plan.md.\n`,
    stderr: "",
  };
}
