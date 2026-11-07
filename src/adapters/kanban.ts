import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { planFromSpec } from "../core/kanban.js";
import { moduleProblem, parsePlan, PRODUCT } from "../core/plan.js";
import { specTrace } from "../core/spec.js";
import { loadManifest } from "./manifest.js";
import { planFile, planViews, readPlan, specFile } from "./plan-file.js";
import { appendAudit } from "./audit-log.js";
import { readFileHash, readState, statePaths, withLock } from "./state-store.js";
import { checkSetupPath } from "./workspace.js";

const textOf = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");

export async function boardSnapshot(project: string) {
  const manifest = await loadManifest(project);
  if (manifest?.workflow !== "kanban")
    throw new Error(
      "Bảng task cần workflow: kanban. Khởi tạo bằng verid cook --mode prep --workflow kanban.",
    );
  const state = readState(statePaths(project));
  const plan = readPlan(project, manifest.iterations !== undefined);
  const spec = textOf(specFile(project));
  const planText = textOf(planFile(project));
  const active = state.kanban.active;
  const specChanged = active !== null && active.spec_sha256 !== readFileHash(specFile(project));
  const missing = ["research.md", "spec.md", "design.md"].filter(
    (file) => !textOf(join(project, ".verid", file)).trim(),
  );
  const views = plan?.ok ? planViews(project, plan, state) : [];
  const tasks = plan?.ok
    ? plan.modules.map((module) => {
        const view = views.find((item) => item.name === module.name)!;
        const selected = active?.module === module.name;
        const needsReapproval =
          selected &&
          (specChanged ||
            state.modules[module.name]?.sha256 !== plan.hashes[module.name] ||
            state.modules[module.name]?.design_sha256 !==
              readFileHash(join(project, ".verid/design.md")));
        const column =
          view.phase === "done"
            ? "done"
            : selected && active.session === null
              ? "selected"
              : selected && view.phase === "evaluating"
                ? "review"
                : selected
                  ? "progress"
                  : "backlog";
        const waiting = (module.depends ?? []).filter(
          (id) => views.find((item) => item.name === id)?.phase !== "done",
        );
        const reason = state.halted
          ? `Workflow đang dừng: ${state.halted.reason}`
          : view.phase === "done"
            ? "Task đã hoàn tất"
            : active && !selected
              ? `Hoàn tất ${active.module} trước khi chọn task tiếp theo`
              : missing.length
                ? `Cần hoàn thiện .verid/${missing.join(", .verid/")}`
                : (moduleProblem(module) ??
                  (module.name === PRODUCT &&
                  views.some((item) => item.name !== PRODUCT && item.phase !== "done")
                    ? "Hoàn tất các task khác trước khi kiểm thử sản phẩm"
                    : null));
        return {
          id: module.name,
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
          canServe:
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
  return {
    project: basename(project),
    workflow: "kanban",
    spec,
    plan: planText,
    planError: plan && !plan.ok ? plan.detail : null,
    active,
    tasks,
    missing,
    halted: state.halted?.reason ?? null,
    tdd: state.tdd.state,
    lastRun: state.tdd.last_run,
    dirty: state.tdd.dirty,
    revision: createHash("sha256")
      .update(JSON.stringify([spec, planText, state]))
      .digest("hex"),
  };
}

/** The local developer UI may edit planning inputs, never while implementation is open. */
export function saveBoardDocument(
  project: string,
  kind: "spec" | "plan" | "split",
  content = "",
): void {
  const paths = statePaths(project);
  withLock(paths, () => {
    const state = readState(paths);
    if (state.kanban.active || Object.values(state.modules).some((item) => item.served_at === null))
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
    appendAudit(paths.audit, { event: "board_document_saved", document: rel });
    // wx prevents replacing a plan created by another process during decomposition.
    writeFileSync(join(project, rel), content.endsWith("\n") ? content : `${content}\n`, {
      flag: kind === "split" ? "wx" : "w",
    });
  });
}

export function taskPrompt(project: string, task: string): string {
  const state = readState(statePaths(project));
  if (state.kanban.active?.module !== task)
    throw new Error("Chọn task này trước khi chuẩn bị session.");
  if (state.kanban.active.session !== null)
    throw new Error("Task này đã có session AI. Tiếp tục session hiện tại; không mở session khác.");
  return `Read AGENTS.md and .verid/spec.md, .verid/design.md, and only the Module: ${task} section of .verid/plan.md. This is a NEW session for task ${task} only. Read .verid/log/${task}.md if it exists. Follow Verid TDD: write a failing test → verid taste → implement → verid taste → independent review. Record results and hand off for developer serve. STOP after this task; do not select or implement any other task. Run CLI commands using the path specified in AGENTS.md.`;
}
