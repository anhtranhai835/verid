import { createHash } from "node:crypto";
import { ownEntry } from "../core/station.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { moveInQueue, planFromSpec } from "../core/kanban.js";
import { autoModules, autoPhase } from "../core/auto.js";
import { kitchenOf } from "../core/kitchen.js";
import { planned, taskSessions, type Manifest } from "../core/manifest.js";
import type { State } from "../core/state.js";
import { moduleProblem, parsePlan, PRODUCT } from "../core/plan.js";
import { specTrace } from "../core/spec.js";
import { loadManifest } from "./manifest.js";
import {
  autoFactsOf,
  dossierStatus,
  orderedModules,
  planFile,
  planViews,
  readPlan,
  servedSections,
  servedModules,
  specFile,
} from "./plan-file.js";
import { scaffoldModule, moduleDrafts } from "./module-scaffold.js";
import { appendAudit, readAudit } from "./audit-log.js";
import { usageReport } from "../core/usage.js";
import {
  languageOf,
  readFileHash,
  readState,
  statePaths,
  withLock,
  writeState,
} from "./state-store.js";
import { checkSetupPath } from "./workspace.js";
import { systemLanguage, t } from "./i18n.js";
import { moduleMockups } from "./board-mockups.js";
import { stationContext } from "./project.js";

const boardMessage = (project: string, key: string) =>
  t(languageOf(project) ?? systemLanguage(), `board.${key}`, {});
const textOf = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");

export async function boardSnapshot(project: string) {
  const manifest = await loadManifest(project, { readOnly: true });
  if (!manifest) throw new Error(boardMessage(project, "err_no_manifest"));
  const state = readState(statePaths(project));
  return snapshotOf(project, manifest, state);
}

function snapshotOf(project: string, manifest: Manifest, state: State) {
  const lang = state.language ?? systemLanguage();
  const say = (key: string, params: Record<string, string> = {}) => t(lang, `board.${key}`, params);
  const usage = new Map(
    usageReport(readAudit(statePaths(project).audit)).map((row) => [row.module, row]),
  );
  const plan = planned(manifest)
    ? readPlan(project, manifest.iterations !== undefined, false, servedSections(state), true)
    : null;
  const facts =
    manifest.drive === "auto" && planned(manifest)
      ? autoFactsOf(project, state, manifest.iterations !== undefined, true, manifest.stations ?? 1)
      : null;
  const phase = facts ? autoPhase(facts) : null;
  const spec = textOf(specFile(project));
  const planText = textOf(planFile(project));
  const autoTask =
    phase?.kind === "module"
      ? phase.view.name
      : state.auto.signed !== null &&
          state.auto.work &&
          !servedModules(state).has(state.auto.work.module)
        ? state.auto.work.module
        : null;
  const active = taskSessions(manifest)
    ? state.kanban.active
    : autoTask
      ? { module: autoTask, session: "ai", spec_sha256: state.auto.signed?.spec_sha256 ?? "" }
      : null;
  const specChanged = active !== null && active.spec_sha256 !== readFileHash(specFile(project));
  const missing = ["research.md", "spec.md", "design.md"].filter(
    (file) => !textOf(join(project, ".verid", file)).trim(),
  );
  const views = plan?.ok
    ? facts && facts.plan?.ok
      ? autoModules(facts.plan.modules, facts.plan.hashes, state.modules, facts.evidence)
      : planViews(project, plan, state)
    : [];
  const stations = Object.fromEntries(
    Object.entries(state.stations).map(([name, record]) => {
      try {
        stationContext(record.path);
        const local = readState(statePaths(record.path));
        return [
          name,
          {
            path: record.path,
            branch: record.branch,
            tdd: local.tdd.state as string,
            dirty: local.tdd.dirty,
            lastRun: local.tdd.last_run,
            served: !!local.modules[name]?.served_at,
            blocked: local.auto.blocked,
            unavailable: false,
            stage: record.stage,
          },
        ];
      } catch {
        return [
          name,
          {
            path: record.path,
            branch: record.branch,
            tdd: "?",
            dirty: true,
            lastRun: null,
            served: false,
            blocked: null,
            unavailable: true,
            stage: record.stage,
          },
        ];
      }
    }),
  );
  let next = false;
  const tasks = plan?.ok
    ? orderedModules(plan.modules, state)
        .filter((module) => !state.station || state.station.module === module.name)
        .map((module) => {
          const view = views.find((item) => item.name === module.name)!;
          const station = ownEntry(stations, module.name) ?? null;
          const selected = station !== null || active?.module === module.name;
          const dossier =
            view.phase === "done" && !/^Artifacts:/m.test(module.text)
              ? { missing: [], unresolved: 0, problem: null }
              : dossierStatus(project, module);
          const needsReapproval =
            selected &&
            !station &&
            (specChanged ||
              (manifest.drive === "auto"
                ? state.auto.plan_sha256 !== facts?.planHash
                : state.modules[module.name]?.sha256 !== plan.hashes[module.name]) ||
              (manifest.drive === "auto"
                ? state.auto.signed?.design_sha256
                : state.modules[module.name]?.design_sha256) !==
                readFileHash(join(project, ".verid/design.md")));
          const column = station
            ? "progress"
            : view.phase === "done"
              ? "done"
              : selected && active?.session === null
                ? "selected"
                : selected && view.phase === "evaluating"
                  ? "review"
                  : selected
                    ? "progress"
                    : "backlog";
          const waiting = (module.depends ?? []).filter(
            (id) => views.find((item) => item.name === id)?.phase !== "done",
          );
          const reason = station
            ? station.unavailable
              ? say("station_unavailable")
              : station.served
                ? say("station_waiting")
                : say("station", { module: module.name, tdd: station.tdd })
            : state.halted
              ? say("halted", { reason: state.halted.reason })
              : view.phase === "done"
                ? say("reason_done")
                : active && !selected
                  ? say("reason_finish_active", { module: active.module })
                  : missing.length
                    ? say("reason_missing", {
                        files: missing.map((file) => `.verid/${file}`).join(", "),
                      })
                    : (dossier.problem ??
                      moduleProblem(module) ??
                      (module.name === PRODUCT &&
                      views.some((item) => item.name !== PRODUCT && item.phase !== "done")
                        ? say("reason_product")
                        : null));
          const isNext = !next && column === "backlog";
          if (isNext) next = true;
          return {
            id: module.name,
            station,
            tdd: station?.tdd ?? state.tdd.state,
            mockups: moduleMockups(project, module.name),
            usage: usage.get(module.name) ?? null,
            title: /^Title:\s*(.+)$/m.exec(module.text)?.[1] ?? module.name,
            text: module.text,
            acs: module.text
              .split(/\r?\n/)
              .filter((line) => /^\s*[-*]\s+AC-\d+\b/.test(line))
              .map((line) => line.replace(/^\s*[-*]\s+/, "")),
            requirements: [...new Set(module.text.match(/\b(?:REQ|NFR|SEC)-\d+\b/g) ?? [])],
            depends: module.depends ?? [],
            waiting,
            column,
            reason,
            selected,
            specChanged: selected && specChanged,
            needsReapproval,
            dossier: { missing: dossier.missing, unresolved: dossier.unresolved },
            next: isNext,
            canMove:
              !station &&
              column === "backlog" &&
              module.name !== PRODUCT &&
              !Object.hasOwn(state.modules, module.name) &&
              state.auto.work?.module !== module.name,
            canServe:
              !station &&
              taskSessions(manifest) &&
              selected &&
              !needsReapproval &&
              view.phase === "evaluating" &&
              state.review?.module === module.name &&
              state.review.verdict === "pass" &&
              !state.tdd.dirty &&
              state.tdd.failing.length === 0 &&
              (!manifest.roles?.security ||
                (state.security?.module === module.name && state.security.verdict === "pass")),
            review: selected ? (state.review?.verdict ?? null) : null,
          };
        })
    : [];
  // No-brain's restaurant: who works now and what the waiter tells the user, from state only.
  const kitchen =
    manifest.drive === "auto"
      ? kitchenOf({
          phase,
          tdd: state.tdd.state,
          research: !missing.includes("research.md"),
          design: !missing.includes("design.md"),
          halted: state.halted?.reason ?? null,
          denied: state.last_denied,
          tasks,
          now: Date.now(),
        })
      : null;
  return {
    project: basename(project),
    drive: manifest.drive,
    kitchen: kitchen && {
      ...kitchen,
      waiter: kitchen.waiter && {
        say: say(`waiter_${kitchen.waiter.kind}`, kitchen.waiter.params),
        next: say(`waiter_${kitchen.waiter.kind}_next`, kitchen.waiter.params),
      },
    },
    // What the no-brain owner reads before signing; the summary is the agent's plain-language page.
    documents:
      manifest.drive === "auto"
        ? {
            research: textOf(join(project, ".verid/research.md")),
            design: textOf(join(project, ".verid/design.md")),
            summary: textOf(join(project, ".verid/summary.md")),
          }
        : null,
    signed:
      state.auto.signed !== null &&
      state.auto.signed.research_sha256 === readFileHash(join(project, ".verid/research.md")) &&
      state.auto.signed.design_sha256 === readFileHash(join(project, ".verid/design.md")) &&
      state.auto.signed.spec_sha256 === readFileHash(specFile(project)),
    notice: planned(manifest) ? null : say("notice_remix"),
    spec,
    plan: planText,
    planError:
      plan && !plan.ok ? plan.detail : facts?.plan && !facts.plan.ok ? facts.plan.detail : null,
    active,
    tasks,
    missing,
    halted: state.halted?.reason ?? null,
    tdd: state.tdd.state,
    lastRun: state.tdd.last_run,
    dirty: state.tdd.dirty,
    revision: createHash("sha256")
      .update(
        JSON.stringify([
          manifest,
          spec,
          planText,
          state,
          stations,
          plan?.ok ? plan.hashes : null,
          tasks.map((task) => task.dossier),
          tasks.map((task) => task.mockups),
          ...["research.md", "design.md"].map((file) =>
            readFileHash(join(project, ".verid", file)),
          ),
        ]),
      )
      .digest("hex"),
  };
}

/** The local developer UI may edit planning inputs, never while implementation is open. */
export function saveBoardDocument(
  project: string,
  kind: "spec" | "plan" | "split",
  content = "",
  drive?: Manifest["drive"],
): void {
  const paths = statePaths(project);
  withLock(paths, () => {
    const state = readState(paths);
    const aiOpen =
      drive !== "human" &&
      state.auto.signed !== null &&
      ((state.auto.work !== null && !servedModules(state).has(state.auto.work.module)) ||
        autoPhase(autoFactsOf(project, state, false, true)).kind === "module");
    if (
      state.kanban.active ||
      aiOpen ||
      Object.values(state.modules).some((item) => item.served_at === null)
    )
      throw new Error("Đang có task mở. Hoàn tất và nghiệm thu task trước khi sửa tài liệu.");
    const rel = `.verid/${kind === "spec" ? "spec" : "plan"}.md`;
    checkSetupPath(project, rel);
    if (kind === "split") {
      if (existsSync(planFile(project)))
        throw new Error("Đã có plan. Chỉnh sửa task trong plan hiện có; không ghi đè kế hoạch.");
      content = planFromSpec(textOf(specFile(project)));
    }
    if (!content.trim()) throw new Error("Tài liệu không được để trống.");
    if (kind !== "spec") {
      const plan = parsePlan(content);
      if (!plan.ok) throw new Error(plan.detail);
      if (plan.modules.every((module) => module.acs.length === 0))
        throw new Error("Plan cần ít nhất một acceptance criterion dạng - AC-1: hành vi kiểm thử.");
      const trace = specTrace(textOf(specFile(project)), content);
      if (trace.unknown.length || trace.uncovered.length)
        throw new Error(
          `Plan cần bao phủ các yêu cầu trong spec. Chưa có AC: ${trace.uncovered.join(", ") || "—"}. ID không tồn tại: ${trace.unknown.join(", ") || "—"}.`,
        );
    }
    if (kind === "split") {
      const parsed = parsePlan(content);
      if (parsed.ok) for (const module of parsed.modules) moduleDrafts(project, module.name);
    }
    appendAudit(paths.audit, { event: "board_document_saved", document: rel });
    // wx prevents replacing a plan created by another process during decomposition.
    writeFileSync(join(project, rel), content.endsWith("\n") ? content : `${content}\n`, {
      flag: kind === "split" ? "wx" : "w",
    });
    if (kind === "split") {
      const parsed = parsePlan(content);
      if (parsed.ok) for (const module of parsed.modules) scaffoldModule(project, module.name);
    }
  });
}

/** Developer mutation. The server has already verified credential, origin and revision. */
export async function moveTask(
  project: string,
  task: string,
  direction: "up" | "down",
  revision: string,
): Promise<void> {
  const paths = statePaths(project);
  // Resolve manifest before taking the lock: the snapshot itself is read-only under it.
  const manifest = await loadManifest(project, { readOnly: true });
  if (!manifest || !planned(manifest)) throw new Error(boardMessage(project, "err_remix"));
  withLock(paths, () => {
    const snapshot = snapshotOf(project, manifest, readState(paths));
    if (snapshot.revision !== revision) throw new Error(boardMessage(project, "err_stale"));
    const item = snapshot.tasks.find((item) => item.id === task);
    if (!item?.canMove) throw new Error(boardMessage(project, "err_cannot_move"));
    const state = readState(paths);
    const movable = snapshot.tasks.filter((item) => item.canMove).map((item) => item.id);
    const queue = moveInQueue(movable, task, direction);
    appendAudit(paths.audit, { event: "board_task_moved", task, direction });
    writeState(paths, { ...state, kanban: { ...state.kanban, queue } });
  });
}

export function taskPrompt(project: string, task: string): string {
  const state = readState(statePaths(project));
  if (state.kanban.active?.module !== task)
    throw new Error("Chọn task này trước khi chuẩn bị session.");
  if (state.kanban.active.session !== null)
    throw new Error("Task này đã có session AI. Tiếp tục session hiện tại; không mở session khác.");
  return `Start with verid context ${task}: it prints this task's ACs, the spec lines they cite, dependencies, file state and the full-document paths. Open the full spec, design, plan section or log only where it points, or to check a dependency or an exception. This is a NEW session for task ${task} only. Follow Verid TDD: write a failing test → verid taste → implement → verid taste → independent review. Record results and hand off for developer serve. STOP after this task; do not select or implement any other task. Run CLI commands using the path specified in AGENTS.md.`;
}
