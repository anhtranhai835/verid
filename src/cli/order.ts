import { planned, taskSessions } from "../core/manifest.js";
import { ownEntry } from "../core/station.js";
import { inAgentShell } from "../adapters/agent-environment.js";
import { rmSync } from "node:fs";
import { autoNextStep, autoPhase, changedServed } from "../core/auto.js";
import type { Manifest } from "../core/manifest.js";
import { moduleProblem, PRODUCT, openModule } from "../core/plan.js";
import { mappedAgents } from "../core/roles.js";
import { FRESH_AUTO, type State } from "../core/state.js";
import { bilingual } from "../adapters/i18n.js";
import { loadManifest } from "../adapters/manifest.js";
import { appendAudit } from "../adapters/audit-log.js";
import { captureWork, gitTree, gitView } from "../adapters/git.js";
import {
  autoFactsOf,
  blockedFile,
  designFile,
  planFile,
  planViews,
  readDesignHash,
  researchFile,
  specFile,
  unservedDependencies,
} from "../adapters/plan-file.js";
import {
  readState,
  readFileHash,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import type { CliResult } from "./test.js";
import { emitPluginEvent } from "../adapters/plugin-hooks.js";
import { gateProblem } from "../adapters/reheat.js";
import { planModule } from "./plan-module.js";

/**
 * `verid order [module]` (prep and recipe, developer only): record one module of
 * `.verid/plan.md` as the part the tests have to cover now. The approval holds for the module's
 * section as it is, and only one module is open at a time. The file is read once, so the hash and
 * the AC list describe the same bytes.
 */
export async function approve(project: string, wanted: string | undefined): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_APPROVE_IN_AGENT");
  const manifest = await loadManifest(project);
  if (manifest?.drive === "auto") return signAuto(project, manifest, wanted);
  const { plan, name, module } = await planModule(project, "order", wanted);
  const problem = moduleProblem(module);
  if (problem)
    throw new VeridError("VERID_BURNT_PLAN_INVALID", { path: planFile(project), detail: problem });
  // Record the design for advisory change detection; the module section remains signed.
  const design = readDesignHash(project);
  if (design === null)
    throw new VeridError("VERID_BURNT_DESIGN_MISSING", { path: designFile(project) });

  const sha256 = plan.hashes[name] as string;
  const paths = statePaths(project);
  // Where the module's work begins in each Git root: main's commit now. Read before the lock.
  const captured = captureWork(project, manifest!);
  const result = withLock(paths, () => {
    const state = readState(paths);
    const views = planViews(project, plan, state);
    const open = openModule(views.filter((view) => !ownEntry(state.stations, view.name)));
    const kanban = manifest && taskSessions(manifest);
    const specHash = kanban ? readFileHash(specFile(project)) : null;
    if (kanban && specHash === null)
      throw new VeridError("VERID_BURNT_PLAN_NO_SPEC", { target: specFile(project) });
    if (kanban && state.kanban.active && state.kanban.active.module !== name)
      throw new VeridError("VERID_BURNT_MODULE_OPEN", { module: state.kanban.active.module });
    if (ownEntry(state.stations, name))
      throw new VeridError("VERID_BURNT_STATION_INVALID", {
        detail: `module already has a station: ${name}`,
      });
    const keepTask =
      kanban &&
      state.kanban.active?.module === name &&
      state.kanban.active.spec_sha256 === specHash &&
      state.modules[name]?.sha256 === sha256 &&
      state.modules[name]?.design_sha256 === design;
    const taskState = kanban
      ? {
          kanban: {
            ...state.kanban,
            active: keepTask
              ? state.kanban.active
              : { module: name, session: null, spec_sha256: specHash! },
          },
          ...(!keepTask
            ? {
                tdd: {
                  ...state.tdd,
                  state: "RAW" as const,
                  last_run: null,
                  failing: [],
                  rev: state.tdd.rev + 1,
                  dirty: false,
                  passed_acs: [],
                  passed_e2e_acs: [],
                  stub: false,
                  crashed: [],
                },
              }
            : {}),
        }
      : {};
    // The product module says the whole product works, so every other module is done first.
    const waiting = views.filter((v) => v.name !== PRODUCT && v.phase !== "done");
    if (name === PRODUCT && waiting.length > 0)
      throw new VeridError("VERID_BURNT_PRODUCT_TOO_EARLY", {
        modules: waiting.map((v) => v.name).join(", "),
      });
    if (open && open.name !== name)
      throw new VeridError("VERID_BURNT_MODULE_OPEN", { module: open.name });
    // A re-order of the open module keeps where its work began, so earlier commits stay checked.
    const before = state.modules[name];
    const kept = before?.served_at === null ? before.work : undefined;
    const work = kept ?? ("detail" in captured ? {} : captured);
    // A legacy unit is ordered only on a gate that passed on what it holds now.
    const gate = gateProblem(project, state, name);
    if (gate !== null)
      throw new VeridError("VERID_BURNT_REHEAT_GATE", { module: name, detail: gate });
    // Audit first: if it fails, state is untouched and nothing was approved.
    appendAudit(paths.audit, {
      event: "plan_approved",
      module: name,
      sha256,
      acs: module.acs.length,
    });
    // Another module's approval that was never served is stale here (its section changed, or the
    // check above would have refused): drop it, or reverting that section would reopen it next to
    // this one. A new approval is a new chance for Stop to hold the conversation for this module,
    // and needs a new review.
    const served = Object.entries(state.modules).filter(
      ([other, a]) =>
        other !== name && (a.served_at !== null || ownEntry(state.stations, other) !== undefined),
    );
    writeState(paths, {
      ...state,
      ...taskState,
      modules: {
        ...Object.fromEntries(served),
        [name]: {
          sha256,
          acs: module.acs,
          at: new Date().toISOString(),
          served_at: null,
          design_sha256: design,
          work,
        },
      },
      ac_stop_session: null,
      review: null,
      security: null,
      review_epoch: state.review_epoch + 1,
      security_epoch: state.security_epoch + 1,
    });
    // Dependencies are advice: an order before them is recorded and said, never refused.
    const unserved = unservedDependencies(
      views.find((v) => v.name === name)!,
      views,
    );
    if (unserved.length > 0)
      appendAudit(paths.audit, {
        event: "warning",
        code: "ORDER_DEPENDS",
        target: name,
        reason: `${unserved.join(", ")} not served`,
      });
    const acs = module.acs.join(", ");
    const count = module.acs.length;
    const warned =
      unserved.length > 0
        ? `verid: module ${name} waits for ${unserved.join(", ")}, which is not served yet\n`
        : "";
    return {
      exit: 0,
      stdout: `verid: module ${name} approved · ${count} acceptance ${count === 1 ? "criterion" : "criteria"}\n${warned}${bilingual("approve.done", { module: name, acs })}\n`,
      stderr: "",
    };
  });
  result.stderr += await emitPluginEvent(project, "after-order", {
    module: name,
    acs: module.acs,
    dossier: `.verid/artifacts/03-modules/${name}`,
  });
  return result;
}

/**
 * `verid order` in an auto drive (developer only, optional): verid signs research and design
 * itself at the agent's hooks, so the drive never waits for this. The developer may still sign
 * here, which also clears `.verid/blocked.md` and every counter. The drive opens and serves the
 * modules itself, so a module name is refused. Signing starts every loop over and drops the review
 * of the open module; the reviewed plan stands only if neither file changed since the last
 * signature. A served module whose section of the plan was edited since is reopened, and one the
 * plan no longer has is forgotten. Each file is read once, so the hashes signed and the next step
 * describe the same bytes. A closed module waiting for its merge is released when the drive is
 * not stuck: the developer acknowledges an integration that exact matching cannot see, such as a
 * squash with a resolved conflict. Where any other module's work began, and its branch, stay as
 * recorded.
 */
function signAuto(project: string, manifest: Manifest, wanted: string | undefined): CliResult {
  if (wanted !== undefined) throw new VeridError("VERID_BURNT_AUTO_ORDER_MODULE");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const facts = autoFactsOf(
      project,
      state,
      manifest.iterations !== undefined,
      planned(manifest),
      manifest.stations,
    );
    const { researchHash, specHash, designHash } = facts;
    if (researchHash === null)
      throw new VeridError("VERID_BURNT_RESEARCH_MISSING", { path: researchFile(project) });
    if (designHash === null)
      throw new VeridError("VERID_BURNT_DESIGN_MISSING", { path: designFile(project) });

    const before = state.auto.signed;
    // A changed spec, like changed research or design, sends the plan back to review.
    const unchanged =
      before?.research_sha256 === researchHash &&
      before.spec_sha256 === specHash &&
      before.design_sha256 === designHash;
    const edited = facts.plan?.ok ? changedServed(facts.plan.hashes, state.modules) : [];
    // An order that resumes a stuck drive keeps a module's merge wait; one given while it is not
    // stuck is the developer's acknowledgement that the module was integrated.

    const next: State = {
      ...state,
      modules: Object.fromEntries(
        Object.entries(state.modules).filter(([m]) => !edited.includes(m)),
      ),
      review: null,
      security: null,
      review_epoch: state.review_epoch + 1,
      security_epoch: state.security_epoch + 1,
      auto: {
        ...FRESH_AUTO,
        signed: {
          research_sha256: researchHash,
          spec_sha256: specHash,
          design_sha256: designHash,
          at: new Date().toISOString(),
          git: gitView(project) !== null,
          git_repos: gitTree(project, manifest).presence,
        },
        plan_sha256: unchanged ? state.auto.plan_sha256 : null,
        work: state.auto.work,
      },
    };
    // blocked.md is removed below, so it is not read as a reason to stop. Nothing is committed or
    // reviewed yet, so the step does not depend on git.
    const phase = autoPhase({
      ...facts,
      auto: next.auto,
      approvals: next.modules,
      blockedFile: null,
    });
    const step = autoNextStep(phase, true, true, null);
    // Audit first: if it fails, state is untouched and nothing was signed.
    appendAudit(paths.audit, {
      event: "auto_signed",
      research_sha256: researchHash,
      spec_sha256: specHash,
      design_sha256: designHash,
    });
    writeState(paths, next);
    rmSync(blockedFile(project), { force: true });
    const lines = [
      `verid: auto signed · research ${researchHash.slice(0, 8)} · spec ${specHash?.slice(0, 8) ?? "none"} · design ${designHash.slice(0, 8)}`,
      bilingual("auto.signed", {}),
      bilingual(step.key, { ...mappedAgents(manifest.roles), ...step.params }),
    ];
    return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  });
}
