/**
 * verid's handlers in .claude/settings.local.json: per machine and not committed, because they
 * name this machine's verid by absolute path. A relative path would break as soon as the agent
 * cd's into a subdirectory (Claude Code runs later hooks from there), and Claude Code does not
 * expand $CLAUDE_PROJECT_DIR in `args`.
 */
const HOOK_EVENTS = [
  "PreToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
] as const;

/**
 * Settings with verid's handlers for `hook` registered once, after the developer's own.
 * Handlers of any other verid (older path, the Phase 0 checklist) are dropped. Throws, with
 * where the problem is, when the settings do not have the shape Claude Code expects.
 */
export function withVeridHooks(
  settings: unknown,
  hook: string,
): { settings: Record<string, unknown>; changed: boolean } {
  if (!isObject(settings)) throw new Error("settings: expected a JSON object");
  const hooks = settings.hooks ?? {};
  if (!isObject(hooks)) throw new Error("hooks: expected a JSON object");
  const next: Record<string, unknown> = { ...hooks };
  for (const event of HOOK_EVENTS) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error(`hooks.${event}: expected a list`);
    const kept: unknown[] = [];
    for (const group of groups) {
      // Shapes Claude Code may add later are left as they are.
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const others = group.hooks.filter((h) => !isVerid(h) && !isVerid(h, hook));
      if (others.length > 0) kept.push({ ...group, hooks: others });
    }
    next[event] = [...kept, veridGroup(event, hook)];
  }
  const result = { ...settings, hooks: next };
  return { settings: result, changed: JSON.stringify(result) !== JSON.stringify(settings) };
}

/** Whether settings register some verid hook, e.g. a shared settings.json set up by hand. */
export function hasVeridHooks(settings: unknown): boolean {
  if (!isObject(settings) || !isObject(settings.hooks)) return false;
  return Object.values(settings.hooks).some(
    (groups) =>
      Array.isArray(groups) &&
      groups.some((g) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some((h) => isVerid(h))),
  );
}

/** Whether `hook` sees every tool call and, should it crash or hang, blocks the call. */
export function guardsToolCalls(settings: unknown, hook: string): boolean {
  if (!isObject(settings) || !isObject(settings.hooks)) return false;
  const groups = settings.hooks.PreToolUse;
  return (
    Array.isArray(groups) &&
    groups.some(
      (g) =>
        isObject(g) &&
        (g.matcher === "*" || !g.matcher) &&
        Array.isArray(g.hooks) &&
        g.hooks.some((h) => isVerid(h, hook) && isObject(h) && h.onFailure === "block"),
    )
  );
}

function veridGroup(event: (typeof HOOK_EVENTS)[number], hook: string) {
  const handler = {
    type: "command",
    command: "node",
    args: [hook],
    // Claude Code's default is 600 s; onFailure "block" only where a crash must not let a tool run.
    timeout: 10,
    ...(event === "PreToolUse" && { onFailure: "block" }),
  };
  return event === "PreToolUse" ? { matcher: "*", hooks: [handler] } : { hooks: [handler] };
}

/** A handler running some verid's dist/hook.js, or exactly `hook` when given. */
function isVerid(h: unknown, hook?: string): boolean {
  if (!isObject(h)) return false;
  const words = [h.command, ...(Array.isArray(h.args) ? h.args : [])];
  return words.some(
    (w) => typeof w === "string" && (hook ? w === hook : /verid.*[\\/]dist[\\/]hook\.js/i.test(w)),
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
