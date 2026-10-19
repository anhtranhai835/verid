import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalJson } from "../core/canonical-json.js";
import type { AuditEvent } from "../core/override.js";

const GENESIS = "0".repeat(64);
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Hash chain over audit.jsonl. For each record:
 *   line = canonicalJson(record without its own `hash` field)  // keys sorted, no newline
 *   hash = sha256(prev_hash + line), prev_hash of the first record = 64 zeros
 * The stored line is canonicalJson({...record, hash}). This detects edits, it cannot prevent them.
 * Call only while holding the state lock.
 */
export function appendAudit(file: string, event: AuditEvent): void {
  const record = { ...event, ts: new Date().toISOString(), prev_hash: lastHash(file) };
  const hash = sha256(record.prev_hash + canonicalJson(record));
  appendFileSync(file, `${canonicalJson({ ...record, hash })}\n`);
}

// ponytail: reads the whole log for the last hash; tail-read once retention (Phase 3) lets it grow.
function lastHash(file: string): string {
  if (!existsSync(file)) return GENESIS;
  const lines = readFileSync(file, "utf8").trimEnd().split("\n");
  const last = lines.at(-1);
  if (!last) return GENESIS;
  const { hash } = JSON.parse(last) as { hash?: unknown };
  if (typeof hash !== "string") throw new Error("audit log has no hash on its last line");
  return hash;
}

export type ChainCheck = { ok: true; count: number } | { ok: false; line: number };

export function verifyAuditChain(file: string): ChainCheck {
  const lines = readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean);
  let prev = GENESIS;
  for (const [i, line] of lines.entries()) {
    try {
      const { hash, ...record } = JSON.parse(line) as { hash: string; prev_hash: string };
      if (record.prev_hash !== prev || sha256(prev + canonicalJson(record)) !== hash)
        return { ok: false, line: i + 1 };
      prev = hash;
    } catch {
      return { ok: false, line: i + 1 };
    }
  }
  return { ok: true, count: lines.length };
}
