import type { MessageKey } from "./errors.js";
import type { State } from "./state.js";

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
  modules: readonly { name: string }[],
  served: ReadonlySet<string> = new Set(),
  building: string | null = null,
): string[] {
  const names = modules.map((module) => module.name);
  return [...new Set([...(building && !served.has(building) ? [building] : []), ...names])]
    .filter((name) => name !== "product" && names.includes(name))
    .concat(names.includes("product") ? ["product"] : []);
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
