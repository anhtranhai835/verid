export interface TokenUsage {
  /** All input tokens, including cached reads and cache creation. */
  input: number;
  /** Cached reads are a subset of input, never added to the total again. */
  cached: number;
  output: number;
}

export interface ModuleUsage {
  module: string;
  sessions: number;
  taste: number;
  denied: number;
  stopBlocked: number;
  chars: number;
  tokens: (TokenUsage & { total: number }) | null;
}

export const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const EVENTS = new Set([
  "session_start",
  "test_run",
  "test_context",
  "denied",
  "stop_blocked",
  "subagent_stop_blocked",
  "usage_recorded",
  "work_started",
  "module_served",
]);

/** Pure aggregation; old records without module or character counts remain readable. */
export function usageReport(events: readonly Record<string, unknown>[]): ModuleUsage[] {
  const rows = new Map<string, ModuleUsage>();
  const sessions = new Map<string, Set<string>>();
  for (const event of events) {
    if (typeof event.event !== "string" || !EVENTS.has(event.event)) continue;
    const module = typeof event.module === "string" && event.module ? event.module : "planning";
    let row = rows.get(module);
    if (!row) {
      row = { module, sessions: 0, taste: 0, denied: 0, stopBlocked: 0, chars: 0, tokens: null };
      rows.set(module, row);
      sessions.set(module, new Set());
    }
    if (event.event === "session_start") {
      if (typeof event.session === "string") {
        sessions.get(module)!.add(`${event.provider ?? ""}:${event.session}`);
        row.sessions = sessions.get(module)!.size;
      }
    }
    if (event.event === "test_run") row.taste++;
    if (event.event === "denied") row.denied++;
    if (["stop_blocked", "subagent_stop_blocked"].includes(event.event)) row.stopBlocked++;
    if (isCount(event.chars)) row.chars += event.chars;
    if (
      event.event === "usage_recorded" &&
      isCount(event.input) &&
      isCount(event.cached) &&
      isCount(event.output) &&
      event.cached <= event.input
    ) {
      row.tokens ??= { input: 0, cached: 0, output: 0, total: 0 };
      row.tokens.input += event.input;
      row.tokens.cached += event.cached;
      row.tokens.output += event.output;
      row.tokens.total += event.input + event.output;
    }
  }
  return [...rows.values()].sort((a, b) => a.module.localeCompare(b.module));
}
