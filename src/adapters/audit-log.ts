import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
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

// The log keeps every record (it is the evidence trail), so only its tail is read: a record is
// well under TAIL bytes, and a longer last line falls back to reading the whole file.
const TAIL = 64 * 1024;

function lastHash(file: string): string {
  if (!existsSync(file)) return GENESIS;
  const fd = openSync(file, "r");
  let text: string;
  try {
    const size = fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, TAIL));
    readSync(fd, tail, 0, tail.length, size - tail.length);
    text = tail.toString("utf8").trimEnd();
    if (tail.length < size && !text.includes("\n")) text = readFileSync(file, "utf8").trimEnd();
  } finally {
    closeSync(fd);
  }
  const last = text.slice(text.lastIndexOf("\n") + 1);
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
