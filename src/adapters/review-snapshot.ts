import { planned } from "../core/manifest.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { autoPhase } from "../core/auto.js";
import { canonicalJson } from "../core/canonical-json.js";
import type { Manifest } from "../core/manifest.js";
import { openModule } from "../core/plan.js";
import type { State } from "../core/state.js";
import { autoFactsOf, planFile, planViews, readPlan, servedSections } from "./plan-file.js";
import { readFileHash } from "./state-store.js";

/** Bind a reviewer to its actual subject and inputs, independently of later test runs. */
export function reviewSnapshot(
  project: string,
  manifest: Manifest,
  state: State,
  kind: "reviewer" | "security",
) {
  if (manifest.mode === "remix") return null;
  const plan = readPlan(
    project,
    manifest.iterations !== undefined,
    planned(manifest),
    servedSections(state),
  );
  const phase =
    manifest.drive === "auto"
      ? autoPhase(autoFactsOf(project, state, manifest.iterations !== undefined, planned(manifest)))
      : null;
  const module =
    phase === null
      ? plan?.ok
        ? openModule(planViews(project, plan, state))?.name
        : undefined
      : phase.kind === "module"
        ? phase.view.name
        : undefined;
  const subject =
    phase?.kind === "plan" && kind === "reviewer" ? "plan" : module ? `module:${module}` : null;
  if (subject === null) return null;
  const inputs = [
    kind === "reviewer" ? state.review_epoch : state.security_epoch,
    subject,
    readFileHash(planFile(project)),
    plan?.ok ? plan.hashes : null,
    module ? (state.modules[module] ?? null) : null,
    state.auto.signed,
    ...["manifest.yaml", "research.md", "spec.md", "design.md"].map((name) =>
      readFileHash(join(project, ".verid", name)),
    ),
  ];
  return {
    kind,
    subject,
    identity: createHash("sha256").update(canonicalJson(inputs)).digest("hex"),
  };
}
