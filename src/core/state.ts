// zod/mini tree-shakes to ~40 KB; full zod added ~65 ms to every hook start (Phase 0 measurement).
import * as z from "zod/mini";
import { RULE_CODES } from "./errors.js";

const rule = z.enum(RULE_CODES);

const deniedAction = z.strictObject({
  session: z.string(),
  tool: z.string(),
  target: z.string(),
  input_hash: z.string(),
  rule,
  at: z.string(),
});

const pendingOverride = z.strictObject({
  session: z.string(),
  code: z.string(),
  reason: z.string(),
  rule,
  tool: z.string(),
  target: z.string(),
  input_hash: z.string(),
  created_at: z.string(),
});

const override = z.strictObject({
  session: z.string(),
  rule,
  tool: z.string(),
  target: z.string(),
  input_hash: z.string(),
  reason: z.string(),
  created_at: z.string(),
  used: z.boolean(),
  used_at: z.optional(z.string()),
});

/**
 * Every field except schemaVersion has a default, so a developer can bootstrap state
 * by hand with `{"schemaVersion":1}` until `verid init` exists. Unknown fields are
 * rejected rather than silently dropped.
 */
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  counters: z._default(z.strictObject({ blocked_actions: z.int().check(z.nonnegative()) }), {
    blocked_actions: 0,
  }),
  last_denied: z._default(z.nullable(deniedAction), null),
  pending_override: z._default(z.nullable(pendingOverride), null),
  overrides: z._default(z.array(override), []),
});

export type State = z.infer<typeof stateSchema>;
export type DeniedAction = z.infer<typeof deniedAction>;
export type PendingOverride = z.infer<typeof pendingOverride>;
export type Override = z.infer<typeof override>;

export type ParseStateResult =
  | { ok: true; state: State }
  | { ok: false; code: "VERID_E_STATE_CORRUPT" | "VERID_E_STATE_VERSION" };

export function parseState(raw: string): ParseStateResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: "VERID_E_STATE_CORRUPT" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json))
    return { ok: false, code: "VERID_E_STATE_CORRUPT" };
  // Never guess the shape of a version we do not know.
  if ((json as { schemaVersion?: unknown }).schemaVersion !== 1)
    return { ok: false, code: "VERID_E_STATE_VERSION" };
  const parsed = stateSchema.safeParse(json);
  return parsed.success
    ? { ok: true, state: parsed.data }
    : { ok: false, code: "VERID_E_STATE_CORRUPT" };
}
