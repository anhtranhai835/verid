import { taskSessions } from "../core/manifest.js";
import { ownEntry } from "../core/station.js";
import type { MessageKey } from "../core/errors.js";
import { inAgentShell } from "../adapters/agent-environment.js";
import { existsSync } from "node:fs";
import { securityOf } from "../core/auto.js";
import { nextStep, type Approval, type ModuleView } from "../core/plan.js";
import { bilingual } from "../adapters/i18n.js";
import { loadManifest } from "../adapters/manifest.js";
import { appendAudit } from "../adapters/audit-log.js";
import { gitView } from "../adapters/git.js";
import {
  designFile,
  planViews,
  questionLines,
  researchFile,
  specFile,
} from "../adapters/plan-file.js";
import {
  readState,
  readFileHash,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import type { Io } from "../adapters/terminal.js";
import { auditLines } from "../adapters/rule-audit.js";
import type { CliResult } from "./test.js";
import { emitPluginEvent } from "../adapters/plugin-hooks.js";
import { confirmParity, serveParity, signParity } from "../adapters/reheat.js";
import { planModule } from "./plan-module.js";

/**
 * `verid serve <module>` (prep and recipe, developer only): close the open module once its
 * evidence holds. The developer vouches for the review; verid checks the tests: every AC of the
 * module passed in the last valid run, that run passed as a whole, and nothing changed since.
 */
export async function serve(
  project: string,
  wanted: string,
  options: { paritySigned?: boolean; io?: Io } = {},
): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_SERVE_IN_AGENT");
  // Before the plan is read: auto refuses even where there is no plan yet.
  const drive = await loadManifest(project);
  if (drive?.drive === "auto") {
    // The one thing the developer does in a drive that serves by itself: sign a unit's parity.
    if (options.paritySigned && drive.mode === "reheat") {
      const sha256 = signParity(project, wanted);
      return {
        exit: 0,
        stdout: `verid: parity of ${wanted} signed · ${sha256.slice(0, 8)}
${bilingual("reheat.parity_signed", { module: wanted })}
`,
        stderr: "",
      };
    }
    throw new VeridError("VERID_BURNT_AUTO_SERVE");
  }
  const { plan, name, manifest } = await planModule(project, "serve", wanted);
  const paths = statePaths(project);
  // A terminal asks before the lock is taken; what the developer said yes to is bound to its hash.
  const confirmed =
    manifest.mode === "reheat" && !options.paritySigned && options.io
      ? await confirmParity(project, name, options.io)
      : null;
  const { result, reviewFile } = withLock(paths, () => {
    const state = readState(paths);
    const views = planViews(project, plan, state);
    const view = views.find((v) => v.name === name) as ModuleView;
    if (ownEntry(state.stations, name))
      throw new VeridError("VERID_BURNT_STATION_INVALID", {
        detail: "serve inside the station, then station close from the primary worktree",
      });
    if (
      taskSessions(manifest) &&
      (state.kanban.active?.module !== name ||
        state.kanban.active.spec_sha256 !== readFileHash(specFile(project)) ||
        state.modules[name]?.sha256 !== plan.hashes[name] ||
        state.modules[name]?.design_sha256 !== readFileHash(designFile(project)))
    )
      throw new VeridError("VERID_BURNT_TASK_SESSION", {
        detail_key: "task_session.serve_changed",
      });
    // The reason is a message of its own, so it comes in the developer's language.
    const reviewers = (manifest.roles?.reviewer ?? []).join(", ");
    const notReady = (reason: MessageKey, acs = "") =>
      new VeridError("VERID_BURNT_SERVE_NOT_READY", {
        module: name,
        detail_key: reason,
        acs,
        reviewer: reviewers,
        security: (manifest.roles?.security ?? []).join(", "),
      });
    if (view.phase === "planned") throw notReady("serve.not_approved");
    if (view.phase === "done") throw notReady("serve.already");
    if (view.uncovered.length > 0) throw notReady("serve.uncovered", view.uncovered.join(", "));
    const { last_run, failing, dirty } = state.tdd;
    if (last_run === null) throw notReady("serve.no_run");
    if (failing.length > 0) throw notReady("serve.failed");
    if (dirty) throw notReady("serve.dirty");
    // The developer reads a review by the mapped reviewer, recorded after the last change.
    if (reviewers === "") throw notReady("serve.no_reviewer");
    const { review } = state;
    if (review?.module !== name) throw notReady("serve.no_review");
    // A recorded failure never counts as approval.
    if (review.verdict !== "pass") throw notReady("serve.review_failed");
    // A mapped security reviewer must pass the module too, after the last change.
    const security = securityOf(state, manifest.roles);
    if (security !== undefined && !(security?.module === name && security.verdict === "pass"))
      throw notReady("serve.no_security");

    // A legacy unit also needs its gate and the developer's signature on its parity record.
    const parity = serveParity(project, state, name, {
      flag: options.paritySigned === true,
      confirmed,
    });
    const served = { ...(state.modules[name] as Approval), served_at: new Date().toISOString() };
    const next = {
      ...state,
      ...(parity.signedNow && parity.reheat ? { reheat: parity.reheat } : {}),
      modules: { ...state.modules, [name]: served },
      ...(taskSessions(manifest) ? { kanban: { ...state.kanban, active: null } } : {}),
    };
    // The next step is worked out before anything is written, so a file that cannot be read
    // fails the command without serving half of it.
    const after = planViews(project, plan, state, next.modules);
    const questions = questionLines(project);
    const step = nextStep(
      existsSync(researchFile(project)),
      existsSync(designFile(project)),
      after,
      questions.length > 0,
      existsSync(specFile(project)),
    );
    // Audit first: if it fails, state is untouched and the module stays open.
    if (parity.signedNow) appendAudit(paths.audit, { event: "parity_signed", module: name });
    appendAudit(paths.audit, { event: "module_served", module: name });
    writeState(paths, next);
    const lines = [
      `verid: module ${name} served`,
      bilingual("serve.done", { module: name }),
      bilingual("serve.review", { agent: review.agent_type, file: review.file }),
      ...(security
        ? [bilingual("serve.security", { agent: security.agent_type, file: security.file })]
        : []),
      ...auditLines(project, manifest, state),
      ...questions,
      ...(taskSessions(manifest) ? [bilingual("task_session.stop", {})] : []),
      bilingual(step.key, "module" in step ? { module: step.module } : {}),
    ];
    return {
      result: { exit: 0, stdout: `${lines.join("\n")}\n`, stderr: "" },
      reviewFile: review.file,
    };
  });
  result.stderr += await emitPluginEvent(project, "after-serve", {
    module: name,
    commit: gitView(project)?.head ?? null,
    review: reviewFile,
  });
  return result;
}

/** `serve <module>`, with `--parity-signed` before or after it, once at most. */
export const serveArgs = (args: readonly string[]): boolean => {
  const names = args.filter((arg) => arg !== "--parity-signed");
  return names.length === 1 && args.length - names.length <= 1;
};
