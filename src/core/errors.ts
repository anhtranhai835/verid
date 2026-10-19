/** Codes a policy rule can deny with. Overrides are bound to one of these. */
export const RULE_CODES = [
  "VERID_E_STATE_PROTECTED",
  "VERID_E_SECRET_PROTECTED",
  "VERID_E_TRANSCRIPT_PROTECTED",
  "VERID_E_MANIFEST_PROTECTED",
  "VERID_E_BASH_NESTED_CLAUDE",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

/**
 * Stable error codes. They never change between versions and are never translated;
 * each one has an i18n key of the same name in both i18n/vi.json and i18n/en.json.
 */
export const ERROR_CODES = [
  ...RULE_CODES,
  "VERID_E_PAYLOAD",
  "VERID_E_INTERNAL",
  "VERID_E_STATE_MISSING",
  "VERID_E_STATE_CORRUPT",
  "VERID_E_STATE_VERSION",
  "VERID_E_LOCK_TIMEOUT",
  "VERID_E_OVERRIDE_UNATTENDED",
  "VERID_E_OVERRIDE_USAGE",
  "VERID_E_OVERRIDE_NOTHING",
  "VERID_E_OVERRIDE_FORBIDDEN",
  "VERID_E_OVERRIDE_BAD_CODE",
  "VERID_E_OVERRIDE_STALE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** i18n keys for messages that are not errors. */
export const MESSAGE_KEYS = [
  "hint.overridable",
  "hint.not_overridable",
  "override.risk_warning",
  "override.created",
  "prompt.hook_failed",
] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

/**
 * Only these rules accept `/verid allow`. Everything else (state, secrets, transcripts)
 * is an invariant the developer must handle outside the agent.
 */
const OVERRIDABLE: ReadonlySet<RuleCode> = new Set([
  "VERID_E_MANIFEST_PROTECTED",
  "VERID_E_BASH_NESTED_CLAUDE",
]);
export const isOverridable = (code: RuleCode): boolean => OVERRIDABLE.has(code);

export type PolicyDecision =
  | { kind: "allow"; reason: string }
  | { kind: "deny"; code: RuleCode; reason: string; target: string };
