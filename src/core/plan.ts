/** One module of `.verid/plan.md`: a `## Module: <name>` heading and the lines up to the next. */
export interface PlanModule {
  /** "main" when the plan has no module heading: the whole file is then one module. */
  name: string;
  /** AC codes in document order. */
  acs: string[];
  /** The section's exact text, line endings included; for the implicit main, the whole input. */
  text: string;
  /** 1-based line, in the file, of the first `[NEEDS CLARIFICATION` in the section. */
  clarification: number | null;
  /** The AC codes marked `(e2e)`: only an end-to-end test covers them. */
  e2e: string[];
}
export type PlanCheck = { ok: true; modules: PlanModule[] } | { ok: false; detail: string };

const AC_LINE = /^[ \t]*[-*][ \t]+(AC-\d+)[ \t]*(\([eE]2[eE]\))?:[ \t]*\S/;
// `AC_1` too: Java, Go or Python test names cannot hold a dash. `_` may come before it (`test_AC_1`).
const AC_IN_NAME = /(?<![A-Za-z0-9-])AC[-_](\d+)(?!\d)/g;
const MODULE_HEADING = /^##[ \t]+Module:[ \t]*(.*?)[ \t]*$/;
const MODULE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const CLARIFY = "[NEEDS CLARIFICATION";
const NO_AC = "no line of the form - AC-1: …";

/**
 * `.verid/plan.md` lists modules, each a `## Module: <kebab-name>` heading followed by its
 * acceptance criteria, one per line as `- AC-<n>: <text>`. Codes are unique across the file.
 * A plan with no heading is one module named main, which keeps plans written before modules
 * existed approvable as they are. An editor on Windows may prepend a BOM; it is ignored for
 * matching but kept in the section text, so the implicit main's text is the file itself.
 */
export function parsePlan(text: string): PlanCheck {
  const lines: { start: number; body: string }[] = [];
  for (let start = 0; ;) {
    const nl = text.indexOf("\n", start);
    const body = text.slice(start, nl < 0 ? text.length : nl).replace(/\r$/, "");
    lines.push({ start, body: start === 0 ? body.replace(/^﻿/, "") : body });
    if (nl < 0) break;
    start = nl + 1;
  }
  const headings = lines.flatMap((l, i) => (MODULE_HEADING.test(l.body) ? [i] : []));
  const seen = new Set<string>();
  const acsIn = (from: number, to: number): string | { acs: string[]; e2e: string[] } => {
    const acs: string[] = [];
    const e2e: string[] = [];
    for (const line of lines.slice(from, to)) {
      const match = AC_LINE.exec(line.body);
      const code = match?.[1];
      if (code === undefined) continue;
      if (seen.has(code)) return `${code} appears twice`;
      seen.add(code);
      acs.push(code);
      if (match?.[2]) e2e.push(code);
    }
    return { acs, e2e };
  };
  const clarificationIn = (from: number, to: number): number | null => {
    const i = lines.slice(from, to).findIndex((l) => l.body.includes(CLARIFY));
    return i < 0 ? null : from + i + 1;
  };

  if (headings.length === 0) {
    const found = acsIn(0, lines.length);
    if (typeof found === "string") return { ok: false, detail: found };
    return {
      ok: true,
      modules: [{ name: "main", ...found, text, clarification: clarificationIn(0, lines.length) }],
    };
  }

  // The intro belongs to no module: an AC there has no owner, and a question there is about
  // the whole plan.
  const first = headings[0] as number;
  const stray = lines.slice(0, first).find((l) => AC_LINE.test(l.body));
  if (stray) return { ok: false, detail: `${AC_LINE.exec(stray.body)?.[1]} is outside any module` };
  const intro = clarificationIn(0, first);
  if (intro !== null) return { ok: false, detail: `line ${intro} still has ${CLARIFY}]` };

  const modules: PlanModule[] = [];
  for (const [k, h] of headings.entries()) {
    const next = headings[k + 1] ?? lines.length;
    const name = MODULE_HEADING.exec((lines[h] as { body: string }).body)?.[1] ?? "";
    if (!MODULE_NAME.test(name))
      return { ok: false, detail: `module name ${name} is not kebab-case` };
    if (modules.some((m) => m.name === name))
      return { ok: false, detail: `module ${name} appears twice` };
    const found = acsIn(h + 1, next);
    if (typeof found === "string") return { ok: false, detail: found };
    const end = lines[next]?.start ?? text.length;
    modules.push({
      name,
      ...found,
      text: text.slice((lines[h] as { start: number }).start, end),
      clarification: clarificationIn(h + 1, next),
    });
  }
  return { ok: true, modules };
}

/** The module that says the product works: ordered last, every AC end to end. */
export const PRODUCT = "product";

/** Why `verid order` refuses this module, or null when it can be approved. */
export function moduleProblem(m: PlanModule): string | null {
  if (m.clarification !== null) return `line ${m.clarification} still has ${CLARIFY}]`;
  if (m.acs.length === 0) return NO_AC;
  const unit = m.name === PRODUCT ? m.acs.find((code) => !m.e2e.includes(code)) : undefined;
  return unit ? `every AC of the product module must be (e2e): ${unit} is not` : null;
}

export type ModulePhase = "planned" | "cooking" | "evaluating" | "done";
/** What `verid order` recorded for a module, and when `verid serve` closed it. */
export interface Approval {
  sha256: string;
  acs: string[];
  at: string;
  served_at: string | null;
  design_sha256: string | null;
}
export interface ModuleView {
  name: string;
  phase: ModulePhase;
  acs: string[];
  /** ACs of the module with no passing test in the last valid run. */
  uncovered: string[];
  /** Ordered, not served, and `.verid/design.md` is no longer what the order signed. */
  designChanged: boolean;
  /** When `verid serve` closed it; null unless done. */
  servedAt: string | null;
}

/** What the project shows now: the ACs with a passing test, and the design's hash. */
export interface Evidence {
  passedAcs: readonly string[];
  passedE2eAcs: readonly string[];
  /** null when there is no `.verid/design.md`. */
  designHash: string | null;
}

/**
 * Where each module of the current plan stands. An approval holds only for the section and the
 * design it was given for: once either changes, the module is planned again. A served module
 * stays done whatever the design says now.
 */
export function modulePhases(
  modules: readonly PlanModule[],
  hashes: Readonly<Record<string, string>>,
  approvals: Readonly<Record<string, Approval>>,
  evidence: Evidence,
): ModuleView[] {
  return modules.map(({ name, acs, e2e }) => {
    const approval = approvals[name];
    const uncovered = uncoveredAcs(acs, e2e, evidence);
    const ordered = approval !== undefined && approval.sha256 === hashes[name];
    const served = ordered && approval.served_at !== null;
    // An order made before designs signed none, so it no longer holds either.
    const designChanged =
      ordered &&
      !served &&
      (approval.design_sha256 === null || approval.design_sha256 !== evidence.designHash);
    const phase: ModulePhase = served
      ? "done"
      : !ordered || designChanged
        ? "planned"
        : uncovered.length > 0
          ? "cooking"
          : "evaluating";
    const servedAt = served ? approval.served_at : null;
    return { name, phase, acs, uncovered, designChanged, servedAt };
  });
}

/** The approved module not yet served: the one production code is written for. */
export const openModule = (views: readonly ModuleView[]): ModuleView | undefined =>
  views.find((v) => v.phase === "cooking" || v.phase === "evaluating");

export type NextStep =
  | {
      key:
        "menu.research" | "menu.design" | "menu.ask" | "menu.split" | "menu.served" | "menu.done";
    }
  | { key: "menu.cook" | "menu.evaluate" | "menu.order"; module: string };

/**
 * The one thing to do next, the first that applies. prep and recipe both start from research:
 * what the project is, and where its specification is; then the design: how it is built. Open
 * questions are asked before splitting or ordering, but never before the open module's work. A
 * module whose design changed since its order is ordered again first.
 */
export function nextStep(
  hasResearch: boolean,
  hasDesign: boolean,
  views: readonly ModuleView[],
  hasQuestions: boolean,
): NextStep {
  if (!hasResearch) return { key: "menu.research" };
  if (!hasDesign) return { key: "menu.design" };
  const open = openModule(views);
  if (!open && hasQuestions) return { key: "menu.ask" };
  if (views.every((v) => v.acs.length === 0)) return { key: "menu.split" };
  if (open)
    return { key: open.phase === "cooking" ? "menu.cook" : "menu.evaluate", module: open.name };
  // The product module waits for every other module, wherever it sits in the file.
  const others = views.filter((v) => v.name !== PRODUCT);
  const othersDone = others.every((v) => v.phase === "done");
  const planned = views.filter((v) => v.phase === "planned" && (v.name !== PRODUCT || othersDone));
  const ready = planned.find((v) => v.designChanged) ?? planned.find((v) => v.acs.length > 0);
  if (ready) return { key: "menu.order", module: ready.name };
  // Served last, the product is done; a module served after it asks for the product again.
  const product = views.find((v) => v.name === PRODUCT);
  if (product?.phase === "done") {
    const after = others.some((v) => (v.servedAt ?? "") > (product.servedAt ?? ""));
    return after ? { key: "menu.order", module: PRODUCT } : { key: "menu.done" };
  }
  return planned.length > 0 ? { key: "menu.split" } : { key: "menu.served" };
}

/** A `[NEEDS CLARIFICATION: …]` marker: the question, and its 1-based line in the file. */
export interface Question {
  line: number;
  text: string;
}

const QUESTION = /\[NEEDS CLARIFICATION:?([^\]]*)\]?/g;

/** Every question still to agree with the developer, in file order. */
export function openQuestions(text: string): Question[] {
  return text
    .split("\n")
    .flatMap((body, i) =>
      [...body.matchAll(QUESTION)].map((m) => ({ line: i + 1, text: (m[1] ?? "").trim() })),
    );
}

/**
 * The AC codes a test name mentions, `AC_1` read as `AC-1`. `AC-1` is not found inside `AC-10`,
 * `XAC-1` or `x-AC-1`.
 */
export function acsInName(name: string): string[] {
  return [...name.matchAll(AC_IN_NAME)].map((m) => `AC-${m[1]}`);
}

/**
 * Approved codes with no passing test; an `(e2e)` code needs a passing end-to-end test. Codes
 * match exactly: `AC-01` is not `AC-1`.
 */
export function uncoveredAcs(
  approved: readonly string[],
  e2e: readonly string[],
  passed: Pick<Evidence, "passedAcs" | "passedE2eAcs">,
): string[] {
  const done = new Set(passed.passedAcs);
  const endToEnd = new Set(passed.passedE2eAcs);
  return approved.filter((code) =>
    e2e.includes(code) ? !endToEnd.has(code) : !done.has(code) && !endToEnd.has(code),
  );
}
