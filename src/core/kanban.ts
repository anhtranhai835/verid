import type { State } from "./state.js";

/** A deterministic starting plan. The developer reviews its scope before selecting a task. */
export function planFromSpec(spec: string): string {
  const requirements: Array<{ id: string; text: string }> = [];
  let last: string | null = null;
  for (const line of spec.split(/\r?\n/)) {
    const match = /^\s*[-*]\s+((?:REQ|NFR|SEC)-\d+):\s*(\S.*)$/.exec(line);
    if (match) {
      if (requirements.some((item) => item.id === match[1]))
        throw new Error(`Duplicate requirement: ${match[1]}`);
      requirements.push({ id: match[1]!, text: match[2]! });
      last = match[1]!;
    } else if (last !== null && /^\s*Dropped\b/.test(line)) {
      requirements.pop();
      last = null;
    }
  }
  if (requirements.length === 0)
    throw new Error("Spec cần yêu cầu dạng - REQ-1: hành vi có thể kiểm thử (hoặc NFR-1, SEC-1).");
  if (spec.includes("[NEEDS CLARIFICATION"))
    throw new Error("Hãy giải quyết các mục NEEDS CLARIFICATION trong spec trước khi tách task.");
  return [
    "# Task plan\n\nEach requirement starts as one task. Review and refine acceptance criteria, dependencies and scope before selecting a task. Human drive opens a fresh session per task; AI drive follows the priority queue in one session.\n",
    ...requirements.map(
      (item, index) =>
        `## Module: ${item.id.toLowerCase()}\n\nTitle: ${item.text}\nArtifacts: .verid/artifacts/03-modules/${item.id.toLowerCase()}\n\n- AC-${index + 1}: ${item.text} (${item.id})\n`,
    ),
    `## Module: product\n\nTitle: Kiểm thử luồng sản phẩm hoàn chỉnh\nArtifacts: .verid/artifacts/03-modules/product\nDepends: ${requirements.map((item) => item.id.toLowerCase()).join(", ")}\n\n- AC-${requirements.length + 1} (e2e): Verify the agreed user journeys end to end (${requirements.map((item) => item.id).join(", ")}).\n`,
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

export function taskSessionProblem(
  kanban: State["kanban"],
  session: string,
  specHash: string | null,
): string | null {
  const active = kanban.active;
  if (!active)
    return "Chưa chọn task. Người dùng chọn task trên verid board rồi mở session AI mới.";
  if (active.spec_sha256 !== specHash)
    return "Spec đã thay đổi. Người dùng cần duyệt lại task trên verid board.";
  if (active.session !== session)
    return `Task ${active.module} cần session riêng. Mở session AI mới sau khi chọn task; không dùng lại session của task khác hoặc session lập kế hoạch.`;
  return null;
}
