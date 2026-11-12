import type { MessageKey } from "./errors.js";
import type { State } from "./state.js";

/** Why a spec cannot be split into tasks. The board says it in the developer's language. */
export class SpecSplitError extends Error {
  constructor(
    readonly problem: "requirements" | "clarification" | "duplicate",
    readonly id = "",
  ) {
    super(
      problem === "duplicate"
        ? `Duplicate requirement: ${id}`
        : problem === "requirements"
          ? "The spec needs requirements of the form - REQ-1: testable behaviour (or NFR-1, SEC-1)."
          : "Resolve the NEEDS CLARIFICATION items in the spec before splitting it into tasks.",
    );
  }
}

/**
 * A deterministic starting plan. The developer reviews its scope before selecting a task.
 * `productTitle` names the closing end-to-end task, in the developer's language.
 */
export function planFromSpec(
  spec: string,
  productTitle = "End-to-end check of the complete product",
): string {
  const requirements: Array<{ id: string; text: string }> = [];
  let last: string | null = null;
  for (const line of spec.split(/\r?\n/)) {
    const match = /^\s*[-*]\s+((?:REQ|NFR|SEC)-\d+):\s*(\S.*)$/.exec(line);
    if (match) {
      if (requirements.some((item) => item.id === match[1]))
        throw new SpecSplitError("duplicate", match[1]);
      requirements.push({ id: match[1]!, text: match[2]! });
      last = match[1]!;
    } else if (last !== null && /^\s*Dropped\b/.test(line)) {
      requirements.pop();
      last = null;
    }
  }
  if (requirements.length === 0) throw new SpecSplitError("requirements");
  if (spec.includes("[NEEDS CLARIFICATION")) throw new SpecSplitError("clarification");
  return [
    "# Task plan\n\nEach requirement starts as one task. Review and refine acceptance criteria, dependencies and scope before selecting a task. Human drive opens a fresh session per task; AI drive follows the priority queue in one session.\n",
    ...requirements.map(
      (item, index) =>
        `## Module: ${item.id.toLowerCase()}\n\nTitle: ${item.text}\nArtifacts: .verid/artifacts/03-modules/${item.id.toLowerCase()}\n\n- AC-${index + 1}: ${item.text} (${item.id})\n`,
    ),
    `## Module: product\n\nTitle: ${productTitle}\nArtifacts: .verid/artifacts/03-modules/product\nDepends: ${requirements.map((item) => item.id.toLowerCase()).join(", ")}\n\n- AC-${requirements.length + 1} (e2e): Verify the agreed user journeys end to end (${requirements.map((item) => item.id).join(", ")}).\n`,
  ].join("\n");
}

/** Observe every session, including planning sessions, so an old one cannot claim another task. */
export function claimTaskSession(
  kanban: State["kanban"],
  session: string,
  startup = true,
): State["kanban"] {
  if (Object.hasOwn(kanban.sessions, session)) return kanban;
  const active = kanban.active;
  const claim = startup && active !== null && active.session === null;
  return {
    ...kanban,
    active: claim ? { ...active, session } : active,
    sessions: { ...kanban.sessions, [session]: claim ? active.module : null },
  };
}

/** Stable project order. Current work stays first and the product check stays last. */
export function effectiveOrder(
  queue: readonly string[],
  modules: readonly { name: string }[],
  served: ReadonlySet<string> = new Set(),
  building: string | null = null,
): string[] {
  const names = modules.map((module) => module.name);
  const pending = queue.filter((name) => !served.has(name));
  return [
    ...new Set([...(building && !served.has(building) ? [building] : []), ...pending, ...names]),
  ]
    .filter((name) => name !== "product" && names.includes(name))
    .concat(names.includes("product") ? ["product"] : []);
}

/** Only movable tasks belong in order; product is a fixed end marker. */
export function moveInQueue(
  order: readonly string[],
  id: string,
  direction: "up" | "down",
): string[] {
  const next = [...order];
  const index = next.indexOf(id);
  const other = index + (direction === "up" ? -1 : 1);
  if (
    id === "product" ||
    index < 0 ||
    other < 0 ||
    other >= next.length ||
    next[other] === "product"
  )
    return next;
  [next[index], next[other]] = [next[other]!, next[index]!];
  return next;
}

/**
 * Why a session may not work on the selected task: the message that says it, and the task it
 * names. The key is what the audit log and a repeated denial compare.
 */
export interface TaskProblem {
  key: Extract<MessageKey, `task_session.${string}`>;
  module: string;
}

export function taskSessionProblem(
  kanban: State["kanban"],
  session: string,
  specHash: string | null,
): TaskProblem | null {
  const active = kanban.active;
  if (!active) return { key: "task_session.none", module: "" };
  if (active.spec_sha256 !== specHash)
    return { key: "task_session.spec_changed", module: active.module };
  if (active.session !== session)
    return { key: "task_session.other_session", module: active.module };
  return null;
}
